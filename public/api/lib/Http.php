<?php
// Request parsing and responses for api/book.php. No framework, no surprises:
// urlencoded / multipart / JSON in; JSON (fetch) or a 303 redirect (no-JS form post) out.
declare(strict_types=1);

namespace Blush;

/** A failure with a status code and a message that is safe to show to the visitor. */
final class HttpError extends \RuntimeException
{
    /** @param array<string,string> $errors  field id => how to fix it */
    public function __construct(
        public readonly int $status,
        public readonly string $publicMessage,
        public readonly array $errors = [],
        public readonly string $logEvent = '',
        public readonly array $headers = [],
    ) {
        parent::__construct($publicMessage, $status);
    }
}

final class Request
{
    /** Hard cap on the request body. The whole form, maxed out, is ~7 KB. */
    public const MAX_BODY = 65536;
    /** Hard cap on the number of submitted values (keys + list items). */
    private const MAX_VALUES = 400;

    public static function method(): string
    {
        return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    }

    public static function header(string $name): string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        $v = $_SERVER[$key] ?? '';
        if ($v === '' && strcasecmp($name, 'Content-Type') === 0) {
            $v = $_SERVER['CONTENT_TYPE'] ?? '';
        }
        return is_string($v) ? trim($v) : '';
    }

    /** fetch() callers send Accept: application/json (or X-Requested-With); plain form posts get redirects. */
    public static function wantsJson(): bool
    {
        return str_contains(strtolower(self::header('Accept')), 'application/json')
            || self::header('X-Requested-With') !== '';
    }

    /**
     * The visitor's IP. A proxy/CDN header (client_ip_header) is believed only when the request
     * really comes from one of trusted_proxies; otherwise anyone could pick their own "IP" per request.
     *
     * @param list<string> $trustedProxies IPs or CIDR ranges (v4 or v6)
     */
    public static function clientIp(string $trustedHeader = '', array $trustedProxies = []): string
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        if ($trustedHeader !== '' && self::ipInList($remote, $trustedProxies)) {
            $key = strtoupper(str_replace('-', '_', $trustedHeader));
            if (!str_starts_with($key, 'HTTP_')) {
                $key = 'HTTP_' . $key;
            }
            $v = trim(explode(',', (string) ($_SERVER[$key] ?? ''))[0]);
            if (filter_var($v, FILTER_VALIDATE_IP)) {
                return $v;
            }
        }
        return $remote;
    }

    /**
     * What the rate limit counts: the IPv4 address, or the /64 network of an IPv6 address
     * (one home or phone gets a whole /64, so counting single v6 addresses is easy to dodge).
     */
    public static function rateKeyIp(string $ip): string
    {
        $bin = @inet_pton($ip);
        if ($bin === false || strlen($bin) !== 16) {
            return $ip;
        }
        if (str_starts_with($bin, str_repeat("\0", 10) . "\xff\xff")) {
            return (string) inet_ntop(substr($bin, 12)); // IPv4-mapped (::ffff:1.2.3.4)
        }
        return inet_ntop(substr($bin, 0, 8) . str_repeat("\0", 8)) . '/64';
    }

    /** @param list<string> $list IPs or CIDR ranges */
    public static function ipInList(string $ip, array $list): bool
    {
        $bin = @inet_pton($ip);
        if ($bin === false) {
            return false;
        }
        foreach ($list as $entry) {
            [$net, $bits] = array_pad(explode('/', trim((string) $entry), 2), 2, null);
            $netBin = @inet_pton((string) $net);
            if ($netBin === false || strlen($netBin) !== strlen($bin)) {
                continue;
            }
            $max = strlen($bin) * 8;
            if ($bits !== null && !preg_match('/^\d{1,3}$/', $bits)) {
                continue;
            }
            $bits = $bits === null ? $max : min($max, (int) $bits);
            $bytes = intdiv($bits, 8);
            $rest = $bits % 8;
            if (substr($bin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
                continue;
            }
            if ($rest === 0) {
                return true;
            }
            $mask = (0xFF << (8 - $rest)) & 0xFF;
            if ((ord($bin[$bytes]) & $mask) === (ord($netBin[$bytes]) & $mask)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The submitted answers as field id => string | list<string>.
     * Repeated keys and `name[]` both become lists, so checkbox groups work however the form names them.
     *
     * @return array<string, string|list<string>>
     * @throws HttpError
     */
    public static function fields(): array
    {
        $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length > self::MAX_BODY) {
            throw self::tooLarge();
        }

        $type = strtolower(trim(explode(';', self::header('Content-Type'))[0]));

        if ($type === 'multipart/form-data') {
            // PHP has already parsed it (also when no Content-Length was sent, e.g. chunked).
            // The form has no file inputs, so any file part means this isn't our form.
            if ($_FILES !== [] || self::sizeOf($_POST) > self::MAX_BODY) {
                throw self::tooLarge();
            }
            return self::normalise($_POST);
        }
        if ($type === 'application/x-www-form-urlencoded') {
            return self::parseUrlEncoded(self::rawBody());
        }
        if ($type === 'application/json' || str_ends_with($type, '+json')) {
            $raw = self::rawBody();
            try {
                $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
            } catch (\JsonException) {
                throw new HttpError(400, 'We couldn’t read that request. Please refresh the page and try again.', [], 'bad_json');
            }
            if (!is_array($data) || array_is_list($data) && $data !== []) {
                throw new HttpError(400, 'We couldn’t read that request. Please refresh the page and try again.', [], 'bad_json');
            }
            return self::normalise($data);
        }
        if ($type === '' && $_POST !== []) {
            return self::normalise($_POST);
        }
        throw new HttpError(415, 'Please send the booking form as a normal form submission.', [], 'bad_content_type');
    }

    private static function rawBody(): string
    {
        $raw = file_get_contents('php://input', false, null, 0, self::MAX_BODY + 1);
        if ($raw === false) {
            return '';
        }
        if (strlen($raw) > self::MAX_BODY) {
            throw self::tooLarge();
        }
        return $raw;
    }

    /** Rough byte size of parsed form values (keys + values), for bodies PHP parsed before we could measure them. */
    private static function sizeOf(array $data): int
    {
        $n = 0;
        foreach ($data as $k => $v) {
            $n += strlen((string) $k) + (is_array($v) ? self::sizeOf($v) : strlen(is_scalar($v) ? (string) $v : ''));
        }
        return $n;
    }

    private static function tooLarge(): HttpError
    {
        return new HttpError(413, 'That’s more than we can accept in one go — please shorten your notes and try again.', [], 'too_large');
    }

    /** @return array<string, string|list<string>> */
    public static function parseUrlEncoded(string $raw): array
    {
        $out = [];
        $count = 0;
        foreach (explode('&', $raw) as $pair) {
            if ($pair === '') {
                continue;
            }
            if (++$count > self::MAX_VALUES) {
                break;
            }
            [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
            $k = urldecode($k);
            $v = urldecode($v);
            $isList = str_ends_with($k, '[]');
            if ($isList) {
                $k = substr($k, 0, -2);
            }
            if (!self::validKey($k)) {
                continue;
            }
            if (array_key_exists($k, $out)) {
                $out[$k] = array_merge((array) $out[$k], [$v]);
            } else {
                $out[$k] = $isList ? [$v] : $v;
            }
        }
        return $out;
    }

    /**
     * Flatten whatever PHP / json_decode produced into strings and lists of strings.
     *
     * @param array<mixed> $data
     * @return array<string, string|list<string>>
     */
    private static function normalise(array $data): array
    {
        $out = [];
        $count = 0;
        foreach ($data as $k => $v) {
            $k = (string) $k;
            if (!self::validKey($k) || ++$count > self::MAX_VALUES) {
                continue;
            }
            if (is_array($v)) {
                $list = [];
                foreach ($v as $item) {
                    if (is_scalar($item) && count($list) < 50) {
                        $list[] = self::scalar($item);
                    }
                }
                $out[$k] = $list;
            } elseif (is_scalar($v)) {
                $out[$k] = self::scalar($v);
            }
        }
        return $out;
    }

    private static function scalar(bool|int|float|string $v): string
    {
        if (is_bool($v)) {
            return $v ? 'yes' : '';
        }
        return (string) $v;
    }

    private static function validKey(string $k): bool
    {
        return (bool) preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,63}$/', $k);
    }
}

final class Response
{
    /** Headers every response gets. */
    public static function baseHeaders(): void
    {
        if (headers_sent()) {
            return;
        }
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store, max-age=0');
        header('X-Robots-Tag: noindex, nofollow');
        header('Referrer-Policy: same-origin');
    }

    /** @param array<string,mixed> $body */
    public static function json(int $status, array $body, array $headers = []): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            self::baseHeaders();
            header('Content-Type: application/json; charset=utf-8');
            foreach ($headers as $h) {
                header($h);
            }
        }
        echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public static function redirect(string $location, array $headers = []): void
    {
        if (!headers_sent()) {
            http_response_code(303);
            self::baseHeaders();
            foreach ($headers as $h) {
                header($h);
            }
            header('Location: ' . str_replace(["\r", "\n"], '', $location));
            header('Content-Type: text/plain; charset=utf-8');
        }
        echo 'See ' . $location;
    }
}

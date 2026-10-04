<?php
// Loads blush-config.php (kept OUTSIDE public_html) and fills in safe defaults.
// Every key is documented in api-config/blush-config.example.php.
declare(strict_types=1);

namespace Blush;

final class ConfigMissing extends \RuntimeException
{
}

final class Config
{
    /** @param array<string,mixed> $values */
    private function __construct(private array $values)
    {
    }

    /**
     * Where the config lives: $BLUSH_CONFIG if set (tests, or SetEnv in .htaccess), otherwise
     * the domain folder above public_html: dirname(<public_html>/api, 2) . '/blush-config.php'.
     */
    public static function path(string $apiDir): string
    {
        foreach ([getenv('BLUSH_CONFIG'), $_SERVER['BLUSH_CONFIG'] ?? null, $_SERVER['REDIRECT_BLUSH_CONFIG'] ?? null] as $p) {
            if (is_string($p) && $p !== '') {
                return $p;
            }
        }
        return dirname($apiDir, 2) . '/blush-config.php';
    }

    /** @throws ConfigMissing */
    public static function load(string $apiDir): self
    {
        $path = self::path($apiDir);
        if (!is_file($path) || !is_readable($path)) {
            throw new ConfigMissing('Booking config not found or unreadable at ' . $path);
        }
        $loaded = (static fn (string $file) => require $file)($path);
        if (!is_array($loaded)) {
            throw new ConfigMissing('Booking config at ' . $path . ' must `return [ ... ];` an array');
        }

        // An empty value ('' or null) means "use the default", so the example file can list every key —
        // except where empty is a real setting (no SMTP encryption, no proxy header, no password).
        $emptyAllowed = ['smtp_secure', 'smtp_password', 'client_ip_header'];
        $loaded = array_filter(
            $loaded,
            static fn ($v, $k) => in_array($k, $emptyAllowed, true) || ($v !== null && $v !== ''),
            ARRAY_FILTER_USE_BOTH
        );
        $dataDir = dirname($apiDir, 2) . '/blush-data';
        $values = array_replace(self::defaults($dataDir), $loaded);
        $values['data_dir'] = rtrim((string) $values['data_dir'], '/\\');
        if (empty($values['mail_dir'])) {
            $values['mail_dir'] = $values['data_dir'] . '/mail';
        }
        $values['allowed_origins'] = array_values(array_filter(
            array_map(static fn ($o) => rtrim(strtolower(trim((string) $o)), '/'), (array) $values['allowed_origins'])
        ));
        return new self($values);
    }

    /** @return array<string,mixed> */
    private static function defaults(string $dataDir): array
    {
        return [
            'smtp_host' => 'smtp.hostinger.com',
            'smtp_port' => 465,
            'smtp_secure' => 'ssl',
            'smtp_username' => 'support@blushpicnic.com',
            'smtp_password' => '',
            'from_email' => 'support@blushpicnic.com',
            'from_name' => 'Blush Picnic',
            'to_email' => 'blush.picnic25@gmail.com',
            'reply_to_for_client' => 'blush.picnic25@gmail.com',
            'send_client_confirmation' => true,
            'mail_transport' => 'smtp',
            'mail_dir' => '',
            'data_dir' => $dataDir,
            'keep_unsent' => true,
            'rate_limit_max' => 5,
            'rate_limit_window' => 3600,
            'min_seconds' => 4,
            'confirm_max_per_hour' => 20,
            'site_url' => 'https://blushpicnic.com',
            'allowed_origins' => ['https://blushpicnic.com', 'https://www.blushpicnic.com'],
            'allow_localhost' => false,
            'client_ip_header' => '',
            'trusted_proxies' => [],
        ];
    }

    public function str(string $key): string
    {
        $v = $this->values[$key] ?? '';
        return is_scalar($v) ? trim((string) $v) : '';
    }

    public function int(string $key): int
    {
        return (int) ($this->values[$key] ?? 0);
    }

    public function bool(string $key): bool
    {
        return filter_var($this->values[$key] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    /** @return list<string> */
    public function list(string $key): array
    {
        return array_values(array_map('strval', (array) ($this->values[$key] ?? [])));
    }
}

<?php
// Small on-disk helpers in data_dir (outside public_html): per-IP rate limit, an event log
// without personal details, and a spool of requests that could not be emailed.
declare(strict_types=1);

namespace Blush;

final class DataDir
{
    /** Create data_dir (0700) with a deny-all .htaccess in case it ever ends up inside public_html. */
    public static function ensure(string $dir): bool
    {
        if ($dir === '') {
            return false;
        }
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            return false;
        }
        $ht = $dir . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "Require all denied\nDeny from all\n");
        }
        return is_writable($dir);
    }

    /** A random per-install secret, so stored IP hashes can't be reversed by brute force. */
    public static function salt(string $dir): string
    {
        $file = $dir . '/.salt';
        $salt = is_file($file) ? trim((string) @file_get_contents($file)) : '';
        if (strlen($salt) < 32) {
            $salt = bin2hex(random_bytes(32));
            if (@file_put_contents($file, $salt, LOCK_EX) !== false) {
                @chmod($file, 0600);
            }
        }
        return $salt;
    }
}

final class RateLimiter
{
    private const MAX_KEYS = 5000;

    public function __construct(
        private readonly string $file,
        private readonly int $max,
        private readonly int $window,
    ) {
    }

    /** Seconds until this key may send again; 0 = allowed. Fails open if the file can't be used. */
    public function retryAfter(string $key, int $now): int
    {
        if ($this->max <= 0) {
            return 0;
        }
        $hits = $this->withFile(LOCK_SH, fn (array $data) => [$data, false])[$key] ?? [];
        $hits = array_values(array_filter($hits, fn ($t) => is_int($t) && $t > $now - $this->window));
        if (count($hits) < $this->max) {
            return 0;
        }
        sort($hits);
        return max(1, $hits[count($hits) - $this->max] + $this->window - $now);
    }

    /** Record a send for this key (and prune everything older than the window). */
    public function hit(string $key, int $now): void
    {
        $this->withFile(LOCK_EX, function (array $data) use ($key, $now) {
            $cut = $now - $this->window;
            foreach ($data as $k => $hits) {
                $data[$k] = array_values(array_filter((array) $hits, static fn ($t) => is_int($t) && $t > $cut));
                if ($data[$k] === []) {
                    unset($data[$k]);
                }
            }
            $data[$key][] = $now;
            if (count($data) > self::MAX_KEYS) {
                $data = array_slice($data, -self::MAX_KEYS, null, true);
            }
            return [$data, true];
        });
    }

    /**
     * Open the JSON file under flock, hand its contents to $fn, optionally write back.
     *
     * @param callable(array): array{0: array, 1: bool} $fn
     * @return array<string, list<int>>
     */
    private function withFile(int $lock, callable $fn): array
    {
        $fh = @fopen($this->file, 'c+');
        if ($fh === false) {
            Log::error('rate limit file not writable: ' . basename($this->file));
            return [];
        }
        try {
            if (!flock($fh, $lock)) {
                return [];
            }
            $raw = stream_get_contents($fh);
            $data = json_decode($raw === false || $raw === '' ? '{}' : $raw, true);
            $data = is_array($data) ? $data : [];
            [$data, $write] = $fn($data);
            if ($write) {
                ftruncate($fh, 0);
                rewind($fh);
                fwrite($fh, (string) json_encode($data, JSON_UNESCAPED_SLASHES));
                fflush($fh);
            }
            flock($fh, LOCK_UN);
            return $data;
        } finally {
            fclose($fh);
        }
    }
}

final class Log
{
    public function __construct(private readonly string $dir = '')
    {
    }

    /** One JSON line per request outcome. Never names, emails, phones, raw IPs or answers. */
    public function event(string $event, array $context = []): void
    {
        if ($this->dir === '') {
            return;
        }
        $line = json_encode(['t' => date('c'), 'event' => $event] + $context, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        @file_put_contents($this->dir . '/booking-' . date('Y-m') . '.log', $line . "\n", FILE_APPEND | LOCK_EX);
    }

    /** PHP's error log (Hostinger: hPanel → Advanced → PHP error logs, or error_log in the folder). */
    public static function error(string $message): void
    {
        error_log('[blush-book] ' . str_replace(["\r", "\n"], ' ', $message));
    }
}

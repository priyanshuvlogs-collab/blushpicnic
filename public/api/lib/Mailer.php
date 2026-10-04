<?php
// PHPMailer over Hostinger SMTP (mail_transport "smtp"), or .eml files on disk ("file", for tests).
declare(strict_types=1);

namespace Blush;

use PHPMailer\PHPMailer\PHPMailer;

final class OutgoingEmail
{
    public function __construct(
        public readonly string $kind,        // "business" | "client"
        public readonly string $toEmail,
        public readonly string $toName,
        public readonly string $replyToEmail,
        public readonly string $replyToName,
        public readonly string $subject,
        public readonly string $html,
        public readonly string $text,
        public readonly array $headers = [],  // extra headers: name => value
    ) {
    }
}

final class Mailer
{
    public function __construct(private readonly Config $config, private readonly string $libDir)
    {
    }

    public static function available(string $libDir): bool
    {
        return is_file($libDir . '/PHPMailer/PHPMailer.php') && is_file($libDir . '/PHPMailer/SMTP.php') && is_file($libDir . '/PHPMailer/Exception.php');
    }

    /**
     * Send one email. Throws on failure (message is safe to log: no passwords, addresses redacted).
     * If an SMTP send fails and keep_unsent is on, the finished message is saved to data_dir/unsent/.
     */
    public function send(OutgoingEmail $m, string $ref): void
    {
        if (!self::available($this->libDir)) {
            throw new \RuntimeException('PHPMailer is missing from api/lib/PHPMailer — see tests/api-README.md');
        }
        require_once $this->libDir . '/PHPMailer/Exception.php';
        require_once $this->libDir . '/PHPMailer/PHPMailer.php';
        require_once $this->libDir . '/PHPMailer/SMTP.php';

        $c = $this->config;
        $mail = new PHPMailer(true);
        $mail->isSMTP(); // also for "file": SMTP mode puts To/Subject into the saved headers
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->Encoding = PHPMailer::ENCODING_QUOTED_PRINTABLE;
        $mail->XMailer = ' '; // no "X-Mailer: PHPMailer …" header
        $host = parse_url($c->str('site_url'), PHP_URL_HOST);
        if (is_string($host) && $host !== '') {
            $mail->Hostname = $host; // Message-ID and EHLO name: blushpicnic.com, not the server's own name
        }
        $mail->Host = $c->str('smtp_host');
        $mail->Port = $c->int('smtp_port');
        $mail->SMTPAuth = true;
        $mail->Username = $c->str('smtp_username');
        $mail->Password = (string) ($c->str('smtp_password'));
        $mail->SMTPSecure = match (strtolower($c->str('smtp_secure'))) {
            'ssl', 'smtps' => PHPMailer::ENCRYPTION_SMTPS,
            'tls', 'starttls' => PHPMailer::ENCRYPTION_STARTTLS,
            default => '',
        };
        $mail->Timeout = 15;
        $mail->getSMTPInstance()->Timelimit = 30;

        $mail->setFrom($c->str('from_email'), $c->str('from_name'));
        $mail->addAddress($m->toEmail, Booking::oneLine($m->toName));
        if ($m->replyToEmail !== '') {
            $mail->addReplyTo($m->replyToEmail, Booking::oneLine($m->replyToName));
        }
        $mail->Subject = Booking::oneLine($m->subject);
        $mail->isHTML(true);
        // CRLF line ends before encoding: quoted-printable would otherwise turn every bare LF
        // into "=0A" and leave each part as one long logical line (RFC 2045 wants CRLF text).
        $mail->Body = PHPMailer::normalizeBreaks($m->html, PHPMailer::CRLF);
        $mail->AltBody = PHPMailer::normalizeBreaks($m->text, PHPMailer::CRLF);
        foreach ($m->headers as $name => $value) {
            $mail->addCustomHeader((string) $name, Booking::oneLine((string) $value));
        }

        $mail->preSend();
        $mime = $mail->getSentMIMEMessage();

        if (strtolower($c->str('mail_transport')) === 'file') {
            $this->writeFile($c->str('mail_dir'), $ref . '-' . $m->kind . '.eml', $mime);
            return;
        }

        if ($c->str('smtp_password') === '') {
            $this->keepUnsent($ref, $m->kind, $mime);
            throw new \RuntimeException('smtp_password is empty in blush-config.php');
        }
        try {
            $mail->postSend();
        } catch (\Throwable $e) {
            $this->keepUnsent($ref, $m->kind, $mime);
            throw new \RuntimeException(self::redact($mail->ErrorInfo !== '' ? $mail->ErrorInfo : $e->getMessage()), 0, $e);
        } finally {
            $mail->smtpClose();
        }
    }

    private function writeFile(string $dir, string $name, string $content): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new \RuntimeException('mail_dir could not be created');
        }
        if (@file_put_contents($dir . '/' . $name, $content, LOCK_EX) === false) {
            throw new \RuntimeException('mail_dir is not writable');
        }
        @chmod($dir . '/' . $name, 0600);
    }

    /** Save the finished business email so a failed send never loses a booking. */
    private function keepUnsent(string $ref, string $kind, string $mime): void
    {
        if ($kind !== 'business' || !$this->config->bool('keep_unsent')) {
            return;
        }
        try {
            $this->writeFile($this->config->str('data_dir') . '/unsent', $ref . '.eml', $mime);
        } catch (\Throwable) {
            Log::error('could not save unsent booking ' . $ref);
        }
    }

    /** Keep error text useful but free of email addresses. */
    public static function redact(string $s): string
    {
        return (string) preg_replace('/[^\s<>"\'(),;:]+@[^\s<>"\'(),;:]+/', '[address]', $s);
    }
}

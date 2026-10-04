<?php
// The two emails: a booking request for the business and a confirmation for the client.
// Table layout + inline CSS for every mail app. Blush Picnic brand (Logo Guide): cocoa #3B2A26 text,
// rose #A14D4B accents, links and buttons, a linen #FBF6F0 card on blush #F6E6E1. The horizontal logo
// heads the card: it's a PNG (mail apps don't show SVG) flattened on linen, so it must sit on linen.
// Headings ask for Cormorant Garamond and text for Jost, falling back to Georgia / the system sans.
// Every piece of user input goes through e() (htmlspecialchars) before it touches HTML.
declare(strict_types=1);

namespace Blush;

final class Emails
{
    private const COCOA = '#3B2A26';     // Cocoa 900 (text)
    private const COCOA_SOFT = '#665049';
    private const ROSE = '#A14D4B';      // Rose 700 (buttons, links, accents; 5.3:1 on linen)
    private const PETAL = '#F6E6E1';     // Blush 100
    private const CREAM = '#FBF6F0';     // Linen
    private const LINE = '#EAD0CA';
    private const LOGO_PATH = '/brand/logo-email.png'; // 560 × 114, horizontal logo on linen
    private const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',Times,serif";
    private const SANS = "Jost,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

    // ── Business: "New booking request" ─────────────────────

    /** $spamNote: why a spam check flagged this request ('' = it didn't), shown above everything else. */
    public static function businessHtml(Booking $b, string $spamNote = ''): string
    {
        $first = $b->firstName();
        $actions = [];
        foreach (self::contactActions($b) as $i => [, $href, $verb, $short]) {
            // The client's "Best way to reach you" comes first, as the filled button.
            $actions[] = self::button($href, $i === 0 && $first !== '' ? $verb . ' ' . $first : $short, $i === 0);
        }
        if ($b->mapsUrl() !== '') {
            $actions[] = self::button($b->mapsUrl(), 'Map', false);
        }

        $sub = implode(' · ', array_filter([$b->occasionName(), $b->dateLabel(), 'from ' . $b->clientName()], 'strlen'));

        $html = ($spamNote !== '' ? self::notice(self::spamNoticeText($spamNote)) : '')
            . self::h1('New booking request')
            . self::p(self::e($sub), 'margin:8px 0 22px;color:' . self::COCOA_SOFT . ';')
            . ($actions ? '<div style="margin:0 0 18px;">' . implode('', $actions) . '</div>' : '')
            . self::rows($b->summaryRows(true))
            . self::estimateBox($b);

        foreach ($b->sections() as $section) {
            $html .= self::h2($section['title']) . self::rows($section['rows']);
        }

        $html .= self::p(
            '<strong style="color:' . self::COCOA . ';">Reference</strong> ' . self::e($b->ref)
            . '<br><strong style="color:' . self::COCOA . ';">Received</strong> ' . self::e($b->receivedLabel()),
            'margin:28px 0 0;font-size:14px;color:' . self::COCOA_SOFT . ';'
        );

        $footer = 'Sent by the booking form on ' . self::e(self::host($b->business['url'])) . '. '
            . 'Hit reply to answer ' . self::e($first !== '' ? $first : 'the client') . ' directly.';

        $preheader = implode(' · ', array_filter([$b->packageName(), $b->timeLabel(), $b->guestsLabel(), $b->answers->get('location')], 'strlen'));
        return self::layout($b->businessSubject(), $preheader, $html, $footer, $b->business['url'] ?? 'https://blushpicnic.com');
    }

    public static function businessText(Booking $b, string $spamNote = ''): string
    {
        $out = [];
        if ($spamNote !== '') {
            $out[] = 'POSSIBLE SPAM: ' . self::spamNoticeText($spamNote);
            $out[] = '';
        }
        $out[] = 'NEW BOOKING REQUEST — ' . $b->ref;
        $out[] = implode(' · ', array_filter([$b->occasionName(), $b->dateLabel(), 'from ' . $b->clientName()], 'strlen'));
        $out[] = '';
        foreach ($b->summaryRows(true) as [$label, $value]) {
            $out[] = $label . ': ' . $value;
        }
        $out[] = '';
        $out[] = 'STARTING ESTIMATE: ' . $b->estimate->headline($b->business['taxNote']);
        foreach ($b->estimate->lines as [$label, $amount]) {
            $out[] = '  - ' . $label . ': ' . Money::format($amount);
        }
        foreach ($b->estimate->toQuote() as $item) {
            $out[] = '  - To quote: ' . $item;
        }
        $out[] = '  (' . self::estimateNote($b) . ')';
        $out[] = '';
        $out[] = 'QUICK ACTIONS';
        foreach (self::contactActions($b) as [$kind, $href, , $short, $preferred]) {
            $out[] = '  ' . $short . ': ' . ($kind === 'email' ? $b->clientEmail() . ' (or just reply)' : $href) . ($preferred ? '  ← preferred' : '');
        }
        if ($b->mapsUrl() !== '') {
            $out[] = '  Map: ' . $b->mapsUrl();
        }
        foreach ($b->sections() as $section) {
            $out[] = '';
            $out[] = '— ' . mb_strtoupper($section['title']) . ' —';
            foreach ($section['rows'] as [$label, $value]) {
                $out[] = $label . ': ' . (str_contains($value, "\n") ? "\n  " . str_replace("\n", "\n  ", $value) : $value);
            }
        }
        $out[] = '';
        $out[] = 'Reference: ' . $b->ref;
        $out[] = 'Received: ' . $b->receivedLabel();
        return implode("\n", $out) . "\n";
    }

    // ── Client: confirmation ────────────────────────────────

    public static function clientHtml(Booking $b): string
    {
        $biz = $b->business;
        $first = $b->greetingName();
        $link = static fn (string $href, string $text): string => self::link($href, $text);
        $tel = $link('tel:' . $biz['phoneE164'], $biz['phoneDisplay']);
        $ig = $link($biz['instagramUrl'], $biz['instagramHandle']);
        $policies = $link(self::policiesUrl($b), 'Read our booking policies');

        $steps = [];
        foreach (self::nextSteps($b) as [$title, $text, $withPolicies]) {
            $steps[] = [$title, self::e($text) . ($withPolicies ? ' ' . $policies . '.' : '')];
        }

        $html = self::label('Request received')
            . self::h1($first !== '' ? 'Thank you, ' . $first . '.' : 'Thank you.')
            . self::p('We’ve received your picnic request. Here’s a summary:', 'margin:10px 0 18px;')
            . self::rows($b->summaryRows(false))
            . self::h2('What happens next')
            . self::steps($steps)
            . self::p(
                'Questions before then, or something to add? Text or call ' . $tel . ', message us on Instagram ' . $ig . ', or simply reply to this email.',
                'margin:24px 0 0;'
            )
            . self::p('Your reference: <strong style="color:' . self::COCOA . ';">' . self::e($b->ref) . '</strong>', 'margin:18px 0 0;font-size:14px;color:' . self::COCOA_SOFT . ';');

        $footer = 'You’re receiving this one-time confirmation because you sent a booking request on '
            . self::e(self::host($biz['url'])) . '.<br>' . self::e($biz['name']);

        return self::layout($b->clientSubject(), 'We’ve received your request. We’ll reply ' . $biz['replyTime'] . ' with availability and your quote.', $html, $footer, $biz['url'] ?? 'https://blushpicnic.com');
    }

    public static function clientText(Booking $b): string
    {
        $biz = $b->business;
        $first = $b->greetingName();
        $out = [];
        $out[] = $first !== '' ? "Thank you, {$first}." : 'Thank you.';
        $out[] = '';
        $out[] = 'We’ve received your picnic request. Here’s a summary:';
        $out[] = '';
        foreach ($b->summaryRows(false) as [$label, $value]) {
            $out[] = $label . ': ' . $value;
        }
        $out[] = '';
        $out[] = 'WHAT HAPPENS NEXT';
        foreach (self::nextSteps($b) as $i => [$title, $text, $withPolicies]) {
            $out[] = ($i + 1) . '. ' . $title;
            $out[] = '   ' . $text . ($withPolicies ? ' Our booking policies: ' . self::policiesUrl($b) : '');
        }
        $out[] = '';
        $out[] = sprintf('Questions before then? Text or call %s, message us on Instagram %s (%s), or simply reply to this email.',
            $biz['phoneDisplay'], $biz['instagramHandle'], $biz['instagramUrl']);
        $out[] = '';
        $out[] = 'Your reference: ' . $b->ref;
        $out[] = '';
        $out[] = '—';
        $out[] = $biz['name'] . ' · ' . self::host($biz['url']);
        $out[] = 'You’re receiving this one-time confirmation because you sent a booking request on ' . self::host($biz['url']) . '.';
        return implode("\n", $out) . "\n";
    }

    /**
     * The client's "What happens next": the two deposits are separate steps so they can't be read as one.
     *
     * @return list<array{0:string,1:string,2:bool}> [title, text, end with the policies link]
     */
    private static function nextSteps(Booking $b): array
    {
        $biz = $b->business;
        $security = $biz['securityDepositSummary'];
        return array_values(array_filter([
            ['We reply with your quote', sprintf('We’ll get back to you %s with availability and your quote.', $biz['replyTime']), false],
            ['Your booking deposit', $biz['bookingDepositSummary'], $security === ''],
            $security !== '' ? ['Your security deposit', $security, true] : null,
            ['We set up, you arrive', 'We deliver, set up, style and clean up — you just arrive.', false],
        ]));
    }

    private static function policiesUrl(Booking $b): string
    {
        return rtrim($b->business['url'], '/') . '/policies';
    }

    // ── Building blocks ─────────────────────────────────────

    /**
     * Ways to reach the client, the one they picked under "Best way to reach you" first.
     *
     * @return list<array{0:string,1:string,2:string,3:string,4:bool}> [kind, href, verb for the filled button, short label, preferred]
     */
    private static function contactActions(Booking $b): array
    {
        $list = [];
        $tel = $b->clientPhoneE164();
        if ($tel !== '') {
            $list['text'] = ['text', 'sms:' . $tel, 'Text', 'Text', false];
            $list['call'] = ['call', 'tel:' . $tel, 'Call', 'Call', false];
        }
        if ($b->clientEmail() !== '') {
            $subject = rawurlencode('Your ' . $b->business['name'] . ' request (' . $b->ref . ')');
            $list['email'] = ['email', 'mailto:' . $b->clientEmail() . '?subject=' . $subject, 'Email', 'Email', false];
        }
        if ($b->instagramUrl() !== '') {
            $list['instagram'] = ['instagram', $b->instagramUrl(), 'DM', 'Instagram', false];
        }
        $pref = strtolower($b->contactPref());
        $kind = match (true) {
            str_contains($pref, 'instagram') => 'instagram',
            str_contains($pref, 'mail') => 'email',
            str_contains($pref, 'text') => 'text',
            str_contains($pref, 'call') => 'call',
            default => '',
        };
        if ($kind !== '' && isset($list[$kind])) {
            $list[$kind][4] = true;
            $list = [$kind => $list[$kind]] + $list;
        }
        return array_values($list);
    }

    public static function e(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    private static function host(string $url): string
    {
        return (string) (parse_url($url, PHP_URL_HOST) ?: $url);
    }

    private static function layout(string $title, string $preheader, string $inner, string $footer, string $siteUrl = 'https://blushpicnic.com'): string
    {
        $site = self::e(rtrim($siteUrl, '/'));
        $logo = self::e(rtrim($siteUrl, '/') . self::LOGO_PATH);
        $p = self::PETAL;
        $c = self::CREAM;
        $l = self::LINE;
        $cocoa = self::COCOA;
        $soft = self::COCOA_SOFT;
        $serif = self::SERIF;
        $sans = self::SANS;
        $t = self::e($title);
        $pre = self::e($preheader) . str_repeat('&#8199;&#847; ', 40);
        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{$t}</title>
<style>
@media only screen and (max-width: 620px) {
  .bp-card { border-radius: 16px !important; }
  .bp-head { padding: 26px 20px 22px !important; }
  .bp-body { padding: 26px 20px 28px !important; }
  .bp-h1 { font-size: 27px !important; }
  .bp-label, .bp-value { display: block !important; width: auto !important; }
  .bp-label { padding: 12px 0 2px !important; border-bottom: 0 !important; }
  .bp-value { padding: 0 0 12px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:{$p};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{$pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{$p}" style="background-color:{$p};">
<tr><td align="center" style="padding:28px 10px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="bp-card" bgcolor="{$c}" style="background-color:{$c};border:1px solid {$l};border-radius:20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="bp-head" align="center" style="padding:32px 36px 26px;border-bottom:1px solid {$l};"><a href="{$site}" style="text-decoration:none;"><img src="{$logo}" width="272" height="55" alt="Blush Picnic" style="display:block;width:272px;max-width:100%;height:auto;border:0;font-family:{$serif};font-size:22px;letter-spacing:4px;color:{$cocoa};"></a></td></tr>
<tr><td class="bp-body" style="padding:34px 36px 34px;font-family:{$sans};font-size:16px;line-height:1.6;color:{$cocoa};">
{$inner}
</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 16px 0;font-family:{$sans};font-size:13px;line-height:1.6;color:{$soft};text-align:center;">{$footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }

    /** Brand label: Rose 700 spaced small caps, like the logo's tagline. Use once, above the title. */
    private static function label(string $text): string
    {
        return '<p style="margin:0 0 10px;font-family:' . self::SANS . ';font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:' . self::ROSE . ';">'
            . self::e($text) . '</p>';
    }

    private static function link(string $href, string $text): string
    {
        return '<a href="' . self::e($href) . '" style="color:' . self::ROSE . ';text-decoration:underline;">' . self::e($text) . '</a>';
    }

    private static function h1(string $text): string
    {
        return '<h1 class="bp-h1" style="margin:0;font-family:' . self::SERIF . ';font-size:30px;line-height:1.2;font-weight:normal;color:' . self::COCOA . ';">'
            . self::e($text) . '</h1>';
    }

    private static function h2(string $text): string
    {
        return '<h2 style="margin:34px 0 4px;font-family:' . self::SERIF . ';font-size:22px;line-height:1.3;font-weight:normal;color:' . self::COCOA . ';">'
            . self::e($text) . '</h2>';
    }

    /** $html must already be escaped. */
    private static function p(string $html, string $style = ''): string
    {
        return '<p style="margin:0 0 14px;font-family:' . self::SANS . ';font-size:16px;line-height:1.6;color:' . self::COCOA . ';' . $style . '">' . $html . '</p>';
    }

    /** @param list<array{0:string,1:string}> $rows label/value pairs (plain text; escaped here) */
    private static function rows(array $rows): string
    {
        if ($rows === []) {
            return '';
        }
        $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">';
        foreach ($rows as [$label, $value]) {
            $out .= '<tr>'
                . '<td class="bp-label" width="36%" valign="top" style="width:36%;padding:12px 14px 12px 0;border-bottom:1px solid ' . self::LINE . ';font-family:' . self::SANS . ';font-size:14px;line-height:1.45;color:' . self::COCOA_SOFT . ';">'
                . self::e($label) . '</td>'
                . '<td class="bp-value" valign="top" style="padding:12px 0;border-bottom:1px solid ' . self::LINE . ';font-family:' . self::SANS . ';font-size:16px;line-height:1.5;color:' . self::COCOA . ';word-wrap:break-word;overflow-wrap:anywhere;word-break:break-word;">'
                . nl2br(self::e($value), false) . '</td>'
                . '</tr>';
        }
        return $out . '</table>';
    }

    private static function button(string $href, string $label, bool $primary): string
    {
        $style = $primary
            ? 'background-color:' . self::ROSE . ';color:' . self::CREAM . ';border:1px solid ' . self::ROSE . ';'
            : 'background-color:' . self::CREAM . ';color:' . self::COCOA . ';border:1px solid ' . self::COCOA . ';';
        return '<a href="' . self::e($href) . '" style="display:inline-block;margin:0 6px 8px 0;padding:11px 18px;border-radius:999px;'
            . $style . 'font-family:' . self::SANS . ';font-size:15px;font-weight:600;line-height:20px;text-decoration:none;">'
            . self::e($label) . '</a>';
    }

    private static function spamNoticeText(string $why): string
    {
        return 'A spam check flagged this request: ' . $why . '. It may still be a real client, so have a look before deleting it. '
            . 'No confirmation email was sent to them.';
    }

    /** A highlighted plain-text notice. */
    private static function notice(string $text): string
    {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border-collapse:separate;">'
            . '<tr><td bgcolor="' . self::PETAL . '" style="padding:14px 18px;background-color:' . self::PETAL . ';border:1px solid ' . self::ROSE . ';border-radius:12px;font-family:' . self::SANS . ';font-size:15px;line-height:1.5;color:' . self::COCOA . ';">'
            . '<strong>Possible spam.</strong> ' . self::e($text) . '</td></tr></table>';
    }

    private static function estimateNote(Booking $b): string
    {
        return 'Estimate from the website’s starting prices, ' . $b->business['taxNote'] . '. Location and final details change the quote.';
    }

    private static function estimateBox(Booking $b): string
    {
        $est = $b->estimate;
        $lines = '';
        foreach ($est->lines as [$label, $amount]) {
            $lines .= '<tr><td style="padding:3px 12px 3px 0;font-family:' . self::SANS . ';font-size:14px;line-height:1.5;color:' . self::COCOA_SOFT . ';">' . self::e($label) . '</td>'
                . '<td align="right" style="padding:3px 0;font-family:' . self::SANS . ';font-size:14px;line-height:1.5;color:' . self::COCOA . ';white-space:nowrap;">' . self::e(Money::format($amount)) . '</td></tr>';
        }
        foreach ($est->toQuote() as $item) {
            $lines .= '<tr><td colspan="2" style="padding:6px 0 0;font-family:' . self::SANS . ';font-size:14px;line-height:1.5;color:' . self::COCOA . ';">'
                . '<strong>To quote:</strong> ' . self::e($item) . '</td></tr>';
        }
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' . self::PETAL . '" style="margin:26px 0 4px;background-color:' . self::PETAL . ';border-radius:14px;">'
            . '<tr><td style="padding:20px 22px;">'
            . '<p style="margin:0 0 4px;font-family:' . self::SANS . ';font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:' . self::ROSE . ';">Starting estimate</p>'
            . '<p style="margin:0 0 10px;font-family:' . self::SERIF . ';font-size:24px;line-height:1.25;color:' . self::COCOA . ';">' . self::e($est->headline($b->business['taxNote'])) . '</p>'
            . ($lines !== '' ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' . $lines . '</table>' : '')
            . '<p style="margin:10px 0 0;font-family:' . self::SANS . ';font-size:13px;line-height:1.5;color:' . self::COCOA_SOFT . ';">' . self::e(self::estimateNote($b)) . '</p>'
            . '</td></tr></table>';
    }

    /** @param list<array{0:string,1:string}> $steps [title (plain text), body (already escaped HTML)] */
    private static function steps(array $steps): string
    {
        $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">';
        foreach ($steps as $i => [$title, $text]) {
            $out .= '<tr>'
                . '<td width="44" valign="top" style="width:44px;padding:12px 0;">'
                . '<div style="width:30px;height:30px;border-radius:15px;background-color:' . self::PETAL . ';font-family:' . self::SERIF . ';font-size:17px;line-height:30px;text-align:center;color:' . self::ROSE . ';">' . ($i + 1) . '</div></td>'
                . '<td valign="top" style="padding:12px 0;font-family:' . self::SANS . ';font-size:16px;line-height:1.55;color:' . self::COCOA . ';">'
                . '<strong style="display:block;font-weight:600;">' . self::e($title) . '</strong>'
                . '<span style="color:' . self::COCOA_SOFT . ';">' . $text . '</span></td>'
                . '</tr>';
        }
        return $out . '</table>';
    }
}

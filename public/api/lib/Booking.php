<?php
// One validated booking request plus everything the emails need, formatted for people:
// option ids → names, dates → "Sat Jun 13, 2026", times → "5:30 PM", Toronto time throughout.
declare(strict_types=1);

namespace Blush;

final class Booking
{
    public const TZ = 'America/Toronto';

    public readonly Estimate $estimate;
    /** @var array<string,string> */
    public readonly array $business;

    public function __construct(
        public readonly string $ref,
        public readonly \DateTimeImmutable $receivedAt,
        public readonly FormSchema $schema,
        public readonly ValidationResult $answers,
    ) {
        $this->estimate = Estimate::compute($schema, $answers);
        $this->business = $schema->business();
    }

    /** BP-YYYYMMDD-XXXX (no 0/O/1/I so it reads back cleanly over the phone). */
    public static function newRef(\DateTimeImmutable $now): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $tail = '';
        for ($i = 0; $i < 4; $i++) {
            $tail .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return 'BP-' . $now->format('Ymd') . '-' . $tail;
    }

    // ── Headline facts ───────────────────────────────────────

    public function occasionName(): string
    {
        return (string) ($this->answers->occasion['name'] ?? 'Booking');
    }

    public function packageName(): string
    {
        $p = $this->schema->package($this->answers->get('package'));
        return $p ? (string) $p['name'] : '';
    }

    /** "Proposal & Romance · Starting at $495 for 2 guests, before HST" */
    public function packageWithPrice(): string
    {
        $p = $this->schema->package($this->answers->get('package'));
        if (!$p) {
            return '';
        }
        if (!is_numeric($p['priceFrom'] ?? null)) {
            return (string) $p['name'];
        }
        $guests = Estimate::guestsLabel($p);
        return sprintf(
            '%s · Starting at %s%s, %s',
            $p['name'],
            Money::format((float) $p['priceFrom']),
            $guests !== '' ? ' ' . $guests : '',
            $this->business['taxNote']
        );
    }

    public function clientName(): string
    {
        return $this->answers->get('name');
    }

    public function firstName(): string
    {
        $parts = preg_split('/\s+/u', trim($this->clientName())) ?: [];
        return $parts[0] ?? '';
    }

    /** "Priya S." */
    public function shortName(): string
    {
        $parts = preg_split('/\s+/u', trim($this->clientName())) ?: [];
        if (count($parts) < 2) {
            return $parts[0] ?? '';
        }
        return $parts[0] . ' ' . mb_strtoupper(mb_substr((string) end($parts), 0, 1)) . '.';
    }

    public function clientEmail(): string
    {
        return $this->answers->get('email');
    }

    /** +1XXXXXXXXXX for tel:/sms: links (North American numbers get +1). */
    public function clientPhoneE164(): string
    {
        $digits = preg_replace('/\D+/', '', $this->answers->get('phone')) ?? '';
        if (strlen($digits) === 10) {
            return '+1' . $digits;
        }
        return $digits === '' ? '' : '+' . $digits;
    }

    public function instagramUrl(): string
    {
        $h = ltrim($this->answers->get('instagram'), '@ ');
        return preg_match('/^[A-Za-z0-9._]{1,30}$/', $h) ? 'https://instagram.com/' . $h : '';
    }

    public function mapsUrl(): string
    {
        $loc = $this->answers->get('location');
        return $loc === '' ? '' : 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode($loc);
    }

    public function dateLabel(string $id = 'date'): string
    {
        return self::formatDate($this->answers->get($id));
    }

    public function timeLabel(): string
    {
        return self::formatTime($this->answers->get('start_time'));
    }

    /** "2 adults · 1 kid" */
    public function guestsLabel(): string
    {
        $a = $this->answers->get('guests_adults');
        $k = $this->answers->get('guests_kids');
        $out = [];
        if ($a !== '') {
            $out[] = $a . ' ' . ((int) $a === 1 ? 'adult' : 'adults');
        }
        if ($k !== '' && (int) $k > 0) {
            $out[] = $k . ' ' . ((int) $k === 1 ? 'kid' : 'kids');
        }
        return implode(' · ', $out);
    }

    /** "Park — Trinity Bellwoods Park" */
    public function locationLabel(): string
    {
        return implode(' — ', array_filter([$this->display('location_type'), $this->answers->get('location')], 'strlen'));
    }

    public function receivedLabel(): string
    {
        return $this->receivedAt->format('D M j, Y \a\t g:i A') . ' (Toronto time)';
    }

    /** "New booking: Proposal · Sat Jun 13, 2026 · Priya S." — single line, no CR/LF. */
    public function businessSubject(): string
    {
        $parts = array_filter(['New booking: ' . $this->occasionName(), $this->dateLabel(), $this->shortName()], 'strlen');
        return self::oneLine(implode(' · ', $parts));
    }

    public function clientSubject(): string
    {
        return self::oneLine(sprintf('We’ve received your picnic request (%s)', $this->ref));
    }

    /** Short summary rows used at the top of both emails. @return list<array{0:string,1:string}> */
    public function summaryRows(bool $forBusiness): array
    {
        $date = $this->dateLabel();
        $backup = $this->dateLabel('backup_date');
        $rows = [
            ['Occasion', $this->occasionName()],
            ['Package', $forBusiness ? $this->packageWithPrice() : $this->packageName()],
            ['Date', $date . ($backup !== '' ? ($forBusiness ? " (backup: {$backup})" : " · backup {$backup}") : '')],
            ['Start time', $this->timeLabel()],
            ['Guests', $this->guestsLabel()],
            ['Location', $this->locationLabel()],
        ];
        if ($forBusiness) {
            $rows[] = ['Budget', $this->display('budget')];
        }
        return array_values(array_filter($rows, static fn ($r) => trim($r[1]) !== ''));
    }

    /**
     * Every answered question, grouped under its form section title, with the form's own labels.
     *
     * @return list<array{title:string, rows:list<array{0:string,1:string}>}>
     */
    public function sections(): array
    {
        $out = [];
        foreach ($this->schema->groups() as $group) {
            $rows = [];
            foreach ((array) ($group['fields'] ?? []) as $field) {
                $id = (string) ($field['id'] ?? '');
                if ($id === '' || !array_key_exists($id, $this->answers->values)) {
                    continue;
                }
                $rows[] = [trim((string) ($field['label'] ?? $id)), $this->display($id)];
            }
            if ($rows !== []) {
                $out[] = ['title' => (string) ($group['title'] ?? ''), 'rows' => $rows];
            }
        }
        return $out;
    }

    /** One answer formatted for people. */
    public function display(string $id): string
    {
        if (!array_key_exists($id, $this->answers->values)) {
            return '';
        }
        $field = $this->schema->field($id) ?? [];
        $value = $this->answers->values[$id];
        $type = (string) ($field['type'] ?? 'text');
        if (is_array($value)) {
            return implode(', ', array_map(static fn ($v) => FormSchema::optionLabel($field, (string) $v), $value));
        }
        return match ($type) {
            'select', 'radio' => FormSchema::optionLabel($field, $value),
            'date' => self::formatDate($value),
            'month' => self::formatMonth($value),
            'time' => self::formatTime($value),
            'toggle' => $value === 'yes' ? 'Yes' : 'No',
            default => $value,
        };
    }

    public static function formatDate(string $ymd): string
    {
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $ymd, new \DateTimeZone(self::TZ));
        return $d ? $d->format('D M j, Y') : $ymd;
    }

    public static function formatMonth(string $ym): string
    {
        $d = \DateTimeImmutable::createFromFormat('!Y-m', $ym, new \DateTimeZone(self::TZ));
        return $d ? $d->format('F Y') : $ym;
    }

    public static function formatTime(string $hm): string
    {
        $d = \DateTimeImmutable::createFromFormat('!H:i', $hm, new \DateTimeZone(self::TZ));
        return $d ? $d->format('g:i A') : $hm;
    }

    public static function oneLine(string $s): string
    {
        return trim(preg_replace('/[\r\n\t]+/', ' ', $s) ?? '');
    }
}

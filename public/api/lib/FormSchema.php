<?php
// Reads api/form-schema.json — built from src/content/booking-form.yaml + the content collections
// by src/pages/api/form-schema.json.ts — so the server checks exactly the questions the form shows.
declare(strict_types=1);

namespace Blush;

final class FormSchema
{
    /** @var array<string, array{0: array<string,mixed>, 1: array<string,mixed>}> field id => [group, field] */
    private array $fieldIndex = [];

    /** @param array<string,mixed> $data */
    private function __construct(public readonly array $data)
    {
        foreach ($this->groups() as $group) {
            foreach ((array) ($group['fields'] ?? []) as $field) {
                if (is_array($field) && isset($field['id']) && is_string($field['id'])) {
                    $this->fieldIndex[$field['id']] = [$group, $field];
                }
            }
        }
    }

    public static function load(string $path): self
    {
        $raw = is_file($path) ? file_get_contents($path) : false;
        if ($raw === false) {
            throw new \RuntimeException('form-schema.json not found at ' . $path);
        }
        $data = json_decode($raw, true, 64);
        if (!is_array($data) || !isset($data['groups'], $data['occasions']) || !is_array($data['groups'])) {
            throw new \RuntimeException('form-schema.json is not valid');
        }
        return new self($data);
    }

    /** @return list<array<string,mixed>> groups in form order (step, then order) */
    public function groups(): array
    {
        return array_values(array_filter((array) ($this->data['groups'] ?? []), 'is_array'));
    }

    /** @return array<string, array{0: array<string,mixed>, 1: array<string,mixed>}> */
    public function fieldIndex(): array
    {
        return $this->fieldIndex;
    }

    /** @return array<string,mixed>|null */
    public function field(string $id): ?array
    {
        return $this->fieldIndex[$id][1] ?? null;
    }

    /** @return array<string,mixed>|null */
    public function occasion(string $id): ?array
    {
        return $this->find('occasions', $id);
    }

    /** @return array<string,mixed>|null */
    public function package(string $id): ?array
    {
        return $this->find('packages', $id);
    }

    /** @return array<string,mixed>|null */
    public function addon(string $id): ?array
    {
        return $this->find('addons', $id);
    }

    /** @return array<string,mixed>|null */
    private function find(string $list, string $id): ?array
    {
        foreach ((array) ($this->data[$list] ?? []) as $item) {
            if (is_array($item) && ($item['id'] ?? null) === $id) {
                return $item;
            }
        }
        return null;
    }

    /** Same rule as groupApplies() in src/lib/form.ts. */
    public static function groupApplies(array $group, ?string $formGroup): bool
    {
        $applies = array_map('strval', (array) ($group['appliesTo'] ?? []));
        return in_array('*', $applies, true) || ($formGroup !== null && in_array($formGroup, $applies, true));
    }

    /** Human label for a stored option value (ids like "proposal-romance" become "Proposal & Romance"). */
    public static function optionLabel(array $field, string $value): string
    {
        foreach ((array) ($field['options'] ?? []) as $opt) {
            if (is_array($opt) && (string) ($opt['value'] ?? '') === $value) {
                return (string) ($opt['label'] ?? $value);
            }
        }
        return $value;
    }

    /** @return list<string> */
    public static function optionValues(array $field): array
    {
        $values = [];
        foreach ((array) ($field['options'] ?? []) as $opt) {
            if (is_array($opt) && isset($opt['value'])) {
                $values[] = (string) $opt['value'];
            }
        }
        return $values;
    }

    /**
     * Business facts used in emails and error messages.
     * Source of truth is src/content/settings.yaml; it reaches PHP through form-schema.json when the
     * schema carries a "business" block. Until then these fallbacks mirror settings.yaml — keep in sync.
     *
     * @return array{name:string, url:string, phoneDisplay:string, phoneE164:string, email:string,
     *   instagramHandle:string, instagramUrl:string, replyTime:string, depositSummary:string, locationNote:string, taxNote:string}
     */
    public function business(): array
    {
        $fallback = [
            'name' => 'Blush Picnic',
            'url' => 'https://blushpicnic.com',
            'phoneDisplay' => '(647) 878-0539',
            'phoneE164' => '+16478780539',
            'email' => 'blush.picnic25@gmail.com',
            'instagramHandle' => '@blush.picnic',
            'instagramUrl' => 'https://instagram.com/blush.picnic',
            'replyTime' => 'within 24 hours',
            'depositSummary' => '',
            'locationNote' => 'Prices vary by location across the GTA. We confirm your exact quote by message.',
            'taxNote' => 'before HST',
        ];
        $fromSchema = is_array($this->data['business'] ?? null) ? $this->data['business'] : [];
        $out = $fallback;
        foreach ($fallback as $k => $_) {
            $v = $fromSchema[$k] ?? ($k === 'taxNote' ? ($this->data['taxNote'] ?? null) : null);
            if (is_string($v) && trim($v) !== '') {
                $out[$k] = trim($v);
            }
        }
        if ($out['depositSummary'] === '') {
            $out['depositSummary'] = $this->depositSentence() . ' The balance is due before your event. Deposits are non-refundable.';
        }
        return $out;
    }

    /** "A $100 deposit (or 50% for larger events) holds your date." — from schema.deposit. */
    public function depositSentence(): string
    {
        $d = is_array($this->data['deposit'] ?? null) ? $this->data['deposit'] : [];
        $standard = isset($d['standard']) && is_numeric($d['standard']) ? Money::format((float) $d['standard']) : null;
        $pct = null;
        if (isset($d['largeEventPercent']) && is_numeric($d['largeEventPercent'])) {
            $p = (float) $d['largeEventPercent'];
            $pct = (floor($p) === $p ? (string) (int) $p : (string) $p) . '%';
        }
        if ($standard && $pct) {
            return "A {$standard} deposit (or {$pct} for larger events) holds your date.";
        }
        if ($standard) {
            return "A {$standard} deposit holds your date.";
        }
        return 'A deposit holds your date.';
    }
}

final class Money
{
    /** "$1,200" — whole dollars unless there are cents (matches money() in src/lib/site.ts). */
    public static function format(float $n): string
    {
        $cents = abs($n - round($n)) > 0.001;
        return '$' . number_format($n, $cents ? 2 : 0, '.', ',');
    }
}

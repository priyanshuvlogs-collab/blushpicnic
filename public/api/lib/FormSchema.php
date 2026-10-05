<?php
// Reads api/form-schema.json — built from src/content/booking-form.yaml + the content collections
// by src/pages/api/form-schema.json.ts — so the server checks exactly the questions the form shows.
declare(strict_types=1);

namespace Blush;

final class FormSchema
{
    /** Services (services.yaml ids) that book a picnic package: the ones with a package, guests and a picnic location. */
    public const PICNIC_SERVICES = ['picnics', 'proposals'];
    /** Services that are delivered (a delivery slot and address instead of a setup time and place). */
    public const HAMPER_SERVICES = ['birthday-hampers', 'custom-hampers'];
    /** The two "area" answers after the travel areas (AREA_OTHER / AREA_UNSURE in src/lib/form.ts); neither has a fee. */
    public const AREA_OTHER = 'Somewhere else in the GTA';
    public const AREA_UNSURE = 'Not sure yet';

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
        foreach (self::REQUIRED_BUSINESS as $k) {
            $v = $data['business'][$k] ?? null;
            if (!is_string($v) || trim($v) === '') {
                throw new \RuntimeException("form-schema.json has no business.{$k} (rebuild the site: src/lib/form.ts writes it from settings.yaml)");
            }
        }
        // The service question, picnic styles and travel areas (services.yaml, styles.yaml, settings.yaml → travel).
        foreach (['services', 'styles'] as $k) {
            if (!is_array($data[$k] ?? null) || !array_is_list($data[$k])) {
                throw new \RuntimeException("form-schema.json has no {$k} list (rebuild the site: src/lib/form.ts writes it from {$k}.yaml)");
            }
        }
        if (!is_array($data['travel'] ?? null) || !is_array($data['travel']['areas'] ?? null)) {
            throw new \RuntimeException('form-schema.json has no travel.areas (rebuild the site: src/lib/form.ts writes it from settings.yaml)');
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

    /** One of what the business offers (services.yaml): {id, name, short, dm}. @return array<string,mixed>|null */
    public function service(string $id): ?array
    {
        return $this->find('services', $id);
    }

    /** A picnic style (styles.yaml): {id, name, price, included}. @return array<string,mixed>|null */
    public function style(string $id): ?array
    {
        return $this->find('styles', $id);
    }

    /** @return list<array<string,mixed>> services in display order */
    public function services(): array
    {
        return array_values(array_filter((array) ($this->data['services'] ?? []), 'is_array'));
    }

    /** @return list<array<string,mixed>> picnic styles in display order */
    public function styles(): array
    {
        return array_values(array_filter((array) ($this->data['styles'] ?? []), 'is_array'));
    }

    /**
     * Travel fee by area (settings.yaml → travel). fee null = quoted by area.
     *
     * @return array{note: string, areas: list<array{name: string, fee: float|null}>}
     */
    public function travel(): array
    {
        $t = is_array($this->data['travel'] ?? null) ? $this->data['travel'] : [];
        $areas = [];
        foreach ((array) ($t['areas'] ?? []) as $area) {
            if (!is_array($area) || !isset($area['name']) || trim((string) $area['name']) === '') {
                continue;
            }
            $fee = $area['fee'] ?? null;
            $areas[] = ['name' => trim((string) $area['name']), 'fee' => is_numeric($fee) ? (float) $fee : null];
        }
        return ['note' => is_string($t['note'] ?? null) ? trim($t['note']) : '', 'areas' => $areas];
    }

    /** The travel area with this name, or null for "Somewhere else in the GTA", "Not sure yet" and anything unknown. @return array{name: string, fee: float|null}|null */
    public function travelArea(string $name): ?array
    {
        foreach ($this->travel()['areas'] as $area) {
            if ($area['name'] === $name) {
                return $area;
            }
        }
        return null;
    }

    /** @return array<string,mixed>|null */
    private function find(string $list, string $id): ?array
    {
        if ($id === '') {
            return null;
        }
        foreach ((array) ($this->data[$list] ?? []) as $item) {
            if (is_array($item) && (string) ($item['id'] ?? '') === $id) {
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

    /** Business facts form-schema.json must carry (from src/content/settings.yaml); load() refuses a schema without them. */
    public const REQUIRED_BUSINESS = ['name', 'url', 'phoneDisplay', 'phoneE164', 'replyTime'];

    /**
     * Business facts used in emails and error messages. The only source is src/content/settings.yaml,
     * which reaches PHP through the "business", "deposit" and "securityDeposit" blocks of
     * form-schema.json, so nothing here can go stale (no typed phone numbers or prices).
     *
     * @return array{name:string, url:string, phoneDisplay:string, phoneE164:string, email:string,
     *   instagramHandle:string, instagramUrl:string, replyTime:string, depositSummary:string,
     *   bookingDepositSummary:string, securityDepositSummary:string, locationNote:string, taxNote:string}
     */
    public function business(): array
    {
        $b = is_array($this->data['business'] ?? null) ? $this->data['business'] : [];
        $str = static fn ($v): string => is_string($v) ? trim($v) : '';
        $out = [];
        foreach (['name', 'url', 'phoneDisplay', 'phoneE164', 'email', 'instagramHandle', 'instagramUrl', 'replyTime', 'depositSummary', 'locationNote', 'taxNote'] as $k) {
            $out[$k] = $str($b[$k] ?? null);
        }
        if ($out['taxNote'] === '') {
            $out['taxNote'] = $str($this->data['taxNote'] ?? null);
        }
        $out['bookingDepositSummary'] = $str($this->data['deposit']['summary'] ?? null);
        if ($out['bookingDepositSummary'] === '') {
            $out['bookingDepositSummary'] = $this->depositSentence();
        }
        $out['securityDepositSummary'] = $str($this->data['securityDeposit']['summary'] ?? null);
        if ($out['depositSummary'] === '') {
            $out['depositSummary'] = trim($out['bookingDepositSummary'] . ' ' . $out['securityDepositSummary']);
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

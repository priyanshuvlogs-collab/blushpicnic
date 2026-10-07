<?php
// Validates a booking against form-schema.json. Only the questions that APPLY to this submission
// are read (group appliesTo → onlyFor → showIf, exactly like the browser form); everything else
// is dropped, so unknown or non-applicable fields can never reach an email.
declare(strict_types=1);

namespace Blush;

final class ValidationResult
{
    /**
     * @param array<string, string|list<string>> $values  clean answers, schema order, answered fields only
     * @param array<string,string> $errors                 field id => how to fix it
     * @param array<string,mixed>|null $occasion
     */
    public function __construct(
        public readonly array $values,
        public readonly array $errors,
        public readonly ?array $occasion,
    ) {
    }

    public function ok(): bool
    {
        return $this->errors === [];
    }

    public function get(string $id): string
    {
        $v = $this->values[$id] ?? '';
        return is_array($v) ? implode(', ', $v) : $v;
    }

    /** @return list<string> */
    public function list(string $id): array
    {
        $v = $this->values[$id] ?? [];
        return is_array($v) ? $v : ($v === '' ? [] : [$v]);
    }

    /** Every accepted answer, in a stable order — the same answers give the same string. */
    public function fingerprint(): string
    {
        $values = $this->values;
        ksort($values);
        return (string) json_encode($values, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}

final class Validator
{
    /** Event dates: must be today or later (Toronto time). Other dates (wedding, birth…) may be past. */
    public const FUTURE_DATE_FIELDS = ['date', 'backup_date'];
    /** How far ahead an event date may be before we ask the visitor to check the year. */
    private const MAX_YEARS_AHEAD = 3;
    /** Length caps for fields that don't set maxLength in booking-form.yaml. */
    private const DEFAULT_MAX = ['text' => 300, 'textarea' => 3000, 'email' => 254, 'tel' => 30];

    private const TRUTHY = ['yes', 'on', 'true', '1', 'y'];
    private const FALSY = ['', 'no', 'off', 'false', '0', 'n'];

    /** @var array<string, string|list<string>> */
    private array $input = [];
    /** @var array<string,bool> */
    private array $applicable = [];
    private ?string $occasionId = null;
    private ?string $formGroup = null;

    public function __construct(private readonly FormSchema $schema, private readonly \DateTimeImmutable $today)
    {
    }

    /** @param array<string, string|list<string>> $input */
    public function validate(array $input): ValidationResult
    {
        $this->input = $input;
        $this->applicable = [];
        $values = [];
        $errors = [];

        // The occasion follows the service where the form locks it (proposals → proposal, hampers → birthday /
        // other), so a hand-made post can't pair a hamper with, say, a corporate occasion.
        $lock = $this->schema->field('occasion')['lockBy'] ?? null;
        $service = $this->firstScalar($input['service'] ?? '');
        $locked = is_array($lock) && ($lock['field'] ?? '') === 'service' ? ($lock['values'][$service] ?? null) : null;
        // Only a real occasion locks (as in the browser); a typo in lockBy.values leaves the question open.
        if (is_string($locked) && in_array($locked, FormSchema::optionValues($this->schema->field('occasion')), true)) {
            $input['occasion'] = $locked;
            $this->input = $input;
        }
        $occasionId = $this->firstScalar($input['occasion'] ?? '');
        $occasion = $occasionId !== '' ? $this->schema->occasion($occasionId) : null;
        $this->occasionId = $occasion ? (string) $occasion['id'] : null;
        $this->formGroup = $occasion ? (string) ($occasion['formGroup'] ?? 'none') : null;

        foreach ($this->schema->fieldIndex() as $id => [, $field]) {
            if (!$this->isApplicable($id)) {
                continue;
            }
            [$value, $error] = $this->check($field, $input[$id] ?? null);
            if ($error !== null) {
                $errors[$id] = $error;
            } elseif ($value !== '' && $value !== []) {
                $values[$id] = $value;
            }
        }

        return new ValidationResult($values, $errors, $occasion);
    }

    /** Group applies to the occasion's formGroup, onlyFor contains the occasion, showIf is satisfied. */
    private function isApplicable(string $id, int $depth = 0): bool
    {
        if (isset($this->applicable[$id])) {
            return $this->applicable[$id];
        }
        $entry = $this->schema->fieldIndex()[$id] ?? null;
        if ($entry === null || $depth > 8) {
            return false;
        }
        [$group, $field] = $entry;
        $ok = FormSchema::groupApplies($group, $this->formGroup);

        if ($ok && !empty($field['onlyFor'])) {
            $ok = $this->occasionId !== null && in_array($this->occasionId, array_map('strval', (array) $field['onlyFor']), true);
        }
        // showIf: one condition, or a list of conditions that must all hold.
        foreach (self::showIfConditions($field['showIf'] ?? null) as $cond) {
            if (!$ok) {
                break;
            }
            $dep = (string) ($cond['field'] ?? '');
            $depField = $this->schema->field($dep);
            if ($depField === null || !$this->isApplicable($dep, $depth + 1)) {
                $ok = false;
            } else {
                $ok = self::showIfMatches($cond, $this->normalise($depField, $this->input[$dep] ?? null));
            }
        }
        return $this->applicable[$id] = $ok;
    }

    /**
     * A field's showIf as a list of conditions: {field…} → [{field…}]; [{…}, {…}] as is; none → [].
     *
     * @return list<array<string,mixed>>
     */
    public static function showIfConditions(mixed $showIf): array
    {
        if (!is_array($showIf)) {
            return [];
        }
        return array_is_list($showIf) ? array_values(array_filter($showIf, 'is_array')) : [$showIf];
    }

    /**
     * Same rule as showIfMatches() in src/lib/form.ts (the browser) and applicable() in tests/api-test.mjs:
     * equals → that value is among the answers; in → any of those values is; neither → a non-empty answer.
     *
     * @param array<string,mixed> $showIf  {field, equals} | {field, in: [...]} | {field}
     * @param string|list<string> $answer  the dependency's answer(s)
     */
    public static function showIfMatches(array $showIf, string|array $answer): bool
    {
        $values = array_values(array_filter(array_map('strval', (array) $answer), 'strlen'));
        if (array_key_exists('equals', $showIf) && $showIf['equals'] !== null) {
            return in_array((string) $showIf['equals'], $values, true);
        }
        if (is_array($showIf['in'] ?? null)) {
            $wanted = array_map('strval', $showIf['in']);
            foreach ($values as $v) {
                if (in_array($v, $wanted, true)) {
                    return true;
                }
            }
            return false;
        }
        return $values !== [];
    }

    /**
     * Lenient normalisation used to evaluate showIf (no errors).
     *
     * @param string|list<string>|null $raw
     * @return string|list<string>
     */
    private function normalise(array $field, string|array|null $raw): string|array
    {
        $type = (string) ($field['type'] ?? 'text');
        if ($type === 'checkboxes') {
            return array_values(array_filter(array_map(fn ($v) => $this->clean((string) $v, false), (array) ($raw ?? [])), 'strlen'));
        }
        // Two answers to a single-answer question are rejected by check(); for showIf they count as none.
        if (is_array($raw) && count(array_filter($raw, static fn ($x) => trim((string) $x) !== '')) > 1) {
            return '';
        }
        $v = $this->clean($this->firstScalar($raw ?? ''), false);
        if ($type === 'toggle') {
            return in_array(strtolower($v), self::TRUTHY, true) ? 'yes' : '';
        }
        return $v;
    }

    /**
     * @param string|list<string>|null $raw
     * @return array{0: string|list<string>, 1: ?string}  [clean value, error]
     */
    private function check(array $field, string|array|null $raw): array
    {
        $type = (string) ($field['type'] ?? 'text');
        $required = !empty($field['required']);
        $label = trim((string) ($field['label'] ?? ''));

        if ($type === 'checkboxes') {
            return $this->checkCheckboxes($field, $raw, $required, $label);
        }

        if (is_array($raw)) {
            $raw = array_values(array_filter($raw, static fn ($v) => trim((string) $v) !== ''));
            if (count($raw) > 1) {
                return ['', 'Please choose just one answer.'];
            }
            $raw = $raw[0] ?? '';
        }
        $multiline = $type === 'textarea';
        $value = $this->clean((string) ($raw ?? ''), $multiline);

        if ($type === 'toggle') {
            $v = strtolower($value);
            if (in_array($v, self::TRUTHY, true)) {
                return ['yes', null];
            }
            if (!in_array($v, self::FALSY, true)) {
                return ['', 'Please tick or untick this box.'];
            }
            return ['', $required ? 'Please tick this box to continue.' : null];
        }

        if ($value === '') {
            return ['', $required ? $this->requiredMessage($type, $label) : null];
        }

        $max = isset($field['maxLength']) && is_numeric($field['maxLength'])
            ? (int) $field['maxLength']
            : (self::DEFAULT_MAX[$type] ?? self::DEFAULT_MAX['text']);
        if (in_array($type, ['text', 'textarea', 'email', 'tel'], true) && mb_strlen($value) > $max) {
            return ['', sprintf('Please keep this to %d characters or fewer — it’s %d now.', $max, mb_strlen($value))];
        }

        switch ($type) {
            case 'email':
                if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                    return ['', 'That email address doesn’t look quite right — please check it (for example name@example.com).'];
                }
                return [$value, null];

            case 'tel':
                // An extension ("ext 12", "x12") is allowed, as in the browser (validate.ts isValidPhone).
                $number = preg_replace('/\b(ext|x)\.?\s*\d+$/i', '', $value) ?? $value;
                $digits = preg_replace('/\D+/', '', $number) ?? '';
                if (!preg_match('/^[0-9+\-().\/\s]+$/', $number) || strlen($digits) < 10 || strlen($digits) > 15) {
                    return ['', 'Please enter a phone number with the area code, for example 416-555-0123.'];
                }
                return [$value, null];

            case 'date':
                return $this->checkDate((string) $field['id'], $value);

            case 'month':
                if (!preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $value, $m) || (int) $m[1] < 1900) {
                    return ['', 'Please choose a month, for example 2027-03.'];
                }
                return [$value, null];

            case 'time':
                $t = self::parseTime($value);
                return $t === null ? ['', 'Please enter a time, for example 5:30 PM.'] : [$t, null];

            case 'number':
                if (!preg_match('/^-?\d{1,9}$/', $value)) {
                    return ['', is_numeric($value) ? 'Please enter a whole number.' : 'Please enter a number.'];
                }
                $n = (int) $value;
                $min = isset($field['min']) && is_numeric($field['min']) ? (int) $field['min'] : null;
                $maxN = isset($field['max']) && is_numeric($field['max']) ? (int) $field['max'] : null;
                if (($min !== null && $n < $min) || ($maxN !== null && $n > $maxN)) {
                    if ($min !== null && $maxN !== null) {
                        return ['', sprintf('Please enter a number from %d to %d.', $min, $maxN)];
                    }
                    return ['', $min !== null ? sprintf('Please enter %d or more.', $min) : sprintf('Please enter %d or less.', $maxN)];
                }
                return [(string) $n, null];

            case 'select':
            case 'radio':
                if (!in_array($value, FormSchema::optionValues($field), true)) {
                    return ['', 'Please choose one of the listed options.'];
                }
                return [$value, null];

            default: // text, textarea, and anything new added to the YAML later
                if (isset($field['maxWords']) && is_numeric($field['maxWords'])) {
                    $words = self::wordCount($value);
                    if ($words > (int) $field['maxWords']) {
                        return ['', sprintf('Please keep this to %d words or fewer — it’s %d now.', (int) $field['maxWords'], $words)];
                    }
                }
                return [$value, null];
        }
    }

    /**
     * @param string|list<string>|null $raw
     * @return array{0: list<string>, 1: ?string}
     */
    private function checkCheckboxes(array $field, string|array|null $raw, bool $required, string $label): array
    {
        $allowed = FormSchema::optionValues($field);
        $picked = [];
        foreach ((array) ($raw ?? []) as $v) {
            $v = $this->clean((string) $v, false);
            if ($v === '') {
                continue;
            }
            if (!in_array($v, $allowed, true)) {
                return [[], 'Please choose from the listed options.'];
            }
            $picked[$v] = true;
        }
        if ($picked === []) {
            return [[], $required ? sprintf('Please tick at least one option for “%s”.', $label) : null];
        }
        // Keep the form's own order, not the order the browser sent them in.
        return [array_values(array_filter($allowed, static fn ($v) => isset($picked[$v]))), null];
    }

    /** @return array{0: string, 1: ?string} */
    private function checkDate(string $id, string $value): array
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return ['', 'Please choose a real date, for example ' . $this->today->modify('+30 days')->format('Y-m-d') . '.'];
        }
        $today = $this->today->format('Y-m-d');
        if (in_array($id, self::FUTURE_DATE_FIELDS, true)) {
            if ($value < $today) {
                return ['', 'That date has already passed — please choose today or a later date.'];
            }
            if ($value > $this->today->modify('+' . self::MAX_YEARS_AHEAD . ' years')->format('Y-m-d')) {
                return ['', sprintf('Please check the year — that’s more than %d years away.', self::MAX_YEARS_AHEAD)];
            }
        } elseif ((int) $m[1] < 1900 || $value > $this->today->modify('+5 years')->format('Y-m-d')) {
            return ['', 'Please check the year on that date.'];
        }
        return [$value, null];
    }

    private function requiredMessage(string $type, string $label): string
    {
        $isQuestion = (bool) preg_match('/[?…]$/u', $label);
        return match ($type) {
            'email' => 'Please add your email address so we can send your quote.',
            'tel' => 'Please add a phone number so we can reach you.',
            'date', 'month' => 'Please choose a date.',
            'time' => 'Please choose a time.',
            'select', 'radio' => $isQuestion ? sprintf('Please answer “%s”', $label) : sprintf('Please choose an option for “%s”.', $label),
            default => $isQuestion ? sprintf('Please answer “%s”', $label) : sprintf('Please fill in “%s”.', $label),
        };
    }

    /** UTF-8 clean-up: drop invalid bytes, control and bidi-override characters; single-line unless $multiline. */
    private function clean(string $s, bool $multiline): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) {
            $s = mb_scrub($s, 'UTF-8');
        }
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $s = preg_replace('/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}\x{200B}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $s) ?? '';
        if ($multiline) {
            $s = preg_replace("/\n{3,}/", "\n\n", $s) ?? $s;
        } else {
            $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
        }
        return trim($s);
    }

    private function firstScalar(string|array $v): string
    {
        if (is_array($v)) {
            $v = $v[0] ?? '';
        }
        return (string) $v;
    }

    public static function wordCount(string $s): int
    {
        $s = trim($s);
        return $s === '' ? 0 : count(preg_split('/\s+/u', $s) ?: []);
    }

    /** "17:30", "17:30:00", "5:30 pm", "5pm" → "17:30"; null if it isn't a time. */
    public static function parseTime(string $v): ?string
    {
        $v = strtolower(trim($v));
        if (preg_match('/^([01]?\d|2[0-3]):([0-5]\d)(:[0-5]\d(\.\d+)?)?$/', $v, $m)) {
            return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
        }
        if (preg_match('/^(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*([ap])\.?\s*m\.?$/', $v, $m)) {
            $h = (int) $m[1] % 12 + ($m[3] === 'p' ? 12 : 0);
            return sprintf('%02d:%02d', $h, (int) ($m[2] ?? 0));
        }
        return null;
    }
}

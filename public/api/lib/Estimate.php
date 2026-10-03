<?php
// The "starting estimate" in the business email. Same arithmetic and wording as the live estimate
// on /book (src/scripts/booking/estimate.ts), so the owner sees what the client saw:
//
//   total = package priceFrom
//         + (adults + kids − guestsIncluded) × extraGuestPrice   (only when extraGuestPrice is known)
//         + known add-on prices
//
// Unknown amounts are never guessed: extra guests without a price become a note, add-ons with a
// null price are "price on request", and "Help me choose" has no total. Always before HST.
declare(strict_types=1);

namespace Blush;

final class Estimate
{
    /**
     * @param list<array{0:string, 1:float}> $lines   priced lines: [label, amount]
     * @param list<string> $notes                     amounts we can't price ("10 guests: larger groups quoted")
     * @param list<string> $onRequest                 chosen add-ons without a published price
     */
    private function __construct(
        public readonly ?float $total,
        public readonly array $lines,
        public readonly array $notes,
        public readonly array $onRequest,
    ) {
    }

    public static function compute(FormSchema $schema, ValidationResult $r): self
    {
        $addonLines = [];
        $onRequest = [];
        foreach ($r->list('addons') as $id) {
            $addon = $schema->addon($id);
            if ($addon === null) {
                continue;
            }
            if (is_numeric($addon['price'] ?? null)) {
                $addonLines[] = [(string) $addon['name'], (float) $addon['price']];
            } else {
                $onRequest[] = (string) $addon['name'];
            }
        }

        $pkg = $schema->package($r->get('package'));
        if ($pkg === null || !is_numeric($pkg['priceFrom'] ?? null)) {
            return new self(null, $addonLines, [], $onRequest);
        }

        $given = max(0, (int) $r->get('guests_adults')) + max(0, (int) $r->get('guests_kids'));
        $included = (int) ($pkg['guestsIncluded'] ?? 0);
        $guests = $given > 0 ? $given : $included;
        $guestsLabel = self::guestsLabel($pkg);
        $lines = [[trim($pkg['name'] . ', ' . $guestsLabel, ', '), (float) $pkg['priceFrom']]];
        $notes = [];

        $extra = max(0, $guests - $included);
        if ($extra > 0) {
            $each = $pkg['extraGuestPrice'] ?? null;
            if (is_numeric($each)) {
                $lines[] = [sprintf('%d %s × %s', $extra, $extra === 1 ? 'extra guest' : 'extra guests', Money::format((float) $each)), $extra * (float) $each];
            } elseif (is_numeric($pkg['guestsMax'] ?? null)) {
                if ($guests > (int) $pkg['guestsMax']) {
                    $notes[] = sprintf('%d guests: larger groups quoted', $guests);
                }
            } else {
                $notes[] = sprintf('%d guests: extra guests quoted separately', $guests);
            }
        }

        $lines = array_merge($lines, $addonLines);
        return new self(array_sum(array_column($lines, 1)), $lines, $notes, $onRequest);
    }

    /** "for 2 guests" / "for 6–8 guests" (as guestsLabel in packages.yaml) */
    public static function guestsLabel(array $pkg): string
    {
        $in = $pkg['guestsIncluded'] ?? null;
        $max = $pkg['guestsMax'] ?? null;
        if (is_numeric($in) && is_numeric($max) && (int) $max > (int) $in) {
            return sprintf('for %d–%d guests', $in, $max);
        }
        return is_numeric($in) ? sprintf('for %d %s', $in, (int) $in === 1 ? 'guest' : 'guests') : '';
    }

    /** "Starting at $530 before HST" or "To be quoted". */
    public function headline(string $taxNote): string
    {
        return $this->total === null ? 'To be quoted' : sprintf('Starting at %s %s', Money::format($this->total), $taxNote);
    }

    /** Everything that still needs a price, for the "to quote" line. @return list<string> */
    public function toQuote(): array
    {
        return array_merge(
            $this->notes,
            $this->onRequest ? ['Price on request: ' . implode(', ', $this->onRequest)] : []
        );
    }
}

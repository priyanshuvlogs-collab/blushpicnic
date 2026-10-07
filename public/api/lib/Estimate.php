<?php
// The "starting estimate" in the business email. Same arithmetic and wording as the live estimate
// on /book (src/scripts/booking/estimate.ts), so the owner sees what the client saw:
//
//   total = package priceFrom
//         + (adults − guestsIncluded) × extraGuestPrice   (only when extraGuestPrice is known;
//           kids past the included guests get a "we'll confirm" note — no published kids' price)
//         + the picnic style's price (table & chair setup, dome…) when it is published
//         + known add-on prices
//         + the travel fee for the chosen area, when it is published
//
// Only a picnic or proposal with a priced package has a total. Room decor and hampers are "To be
// quoted": their priced add-ons and travel line still show, so the owner sees them. Unknown amounts
// are never guessed: extra guests without a price become a note, a style or area without a price is
// "quoted", add-ons with a null price are "price on request", and "Help me choose" has no total.
// Always before HST.
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
        $lines = [];
        $notes = [];

        // Package and guests: only the picnic services book a package (the validator drops a package
        // sent with any other service, so this is belt and braces).
        $service = $r->get('service');
        $picnic = $service === '' || in_array($service, FormSchema::PICNIC_SERVICES, true);
        $pkg = $picnic ? $schema->package($r->get('package')) : null;
        $priced = $pkg !== null && is_numeric($pkg['priceFrom'] ?? null);
        if ($priced) {
            $adults = max(0, (int) $r->get('guests_adults'));
            $kids = max(0, (int) $r->get('guests_kids'));
            $given = $adults + $kids;
            $included = (int) ($pkg['guestsIncluded'] ?? 0);
            $guests = $given > 0 ? $given : $included;
            $lines[] = [trim($pkg['name'] . ', ' . (is_string($pkg['guestsLabel'] ?? null) && $pkg['guestsLabel'] !== '' ? $pkg['guestsLabel'] : self::guestsLabel($pkg)), ', '), (float) $pkg['priceFrom']];

            $extra = max(0, $guests - $included);
            if ($extra > 0) {
                $each = $pkg['extraGuestPrice'] ?? null;
                if (is_numeric($each)) {
                    // Only adults are priced; kids past the included guests are confirmed in the quote.
                    $extraAdults = max(0, $adults - $included);
                    if ($extraAdults > 0) {
                        $lines[] = [sprintf('%d %s × %s', $extraAdults, $extraAdults === 1 ? 'extra guest' : 'extra guests', Money::format((float) $each)), $extraAdults * (float) $each];
                    }
                    $extraKids = min($kids, $extra);
                    if ($extraKids > 0) {
                        $notes[] = sprintf('%d %s: we’ll confirm pricing in your quote', $extraKids, $extraKids === 1 ? 'kid' : 'kids');
                    }
                } elseif (is_numeric($pkg['guestsMax'] ?? null)) {
                    if ($guests > (int) $pkg['guestsMax']) {
                        $notes[] = sprintf('%d guests: larger groups quoted', $guests);
                    }
                } else {
                    $notes[] = sprintf('%d guests: extra guests quoted separately', $guests);
                }
            }
        }

        // Picnic style: the included one (classic low table) costs nothing extra; the others are a line
        // when priced, otherwise "quoted".
        $style = $schema->style($r->get('picnic_style'));
        if ($style !== null && empty($style['included'])) {
            if (is_numeric($style['price'] ?? null)) {
                $lines[] = [(string) $style['name'], (float) $style['price']];
            } else {
                $notes[] = $style['name'] . ': quoted';
            }
        }

        // Add-ons: priced ones are lines; the rest are "Price on request".
        $onRequest = [];
        foreach ($r->list('addons') as $id) {
            $addon = $schema->addon($id);
            if ($addon === null) {
                continue;
            }
            if (is_numeric($addon['price'] ?? null)) {
                $lines[] = [(string) $addon['name'], (float) $addon['price']];
            } else {
                $onRequest[] = (string) $addon['name'];
            }
        }

        // Travel: a line for an area with a published fee, otherwise a note saying how it is quoted.
        $area = $r->get('area');
        if ($area !== '') {
            $known = $schema->travelArea($area);
            if ($known !== null && $known['fee'] !== null) {
                $lines[] = ['Travel to ' . $known['name'], $known['fee']];
            } elseif ($known !== null) {
                $notes[] = 'Travel to ' . $known['name'] . ': quoted by area';
            } elseif ($area === FormSchema::AREA_UNSURE) {
                $notes[] = 'Travel: quoted once you choose an area';
            } else { // "Somewhere else in the GTA" (and any other answer the form may add later)
                $notes[] = 'Travel: quoted by area';
            }
        }

        return new self($priced ? array_sum(array_column($lines, 1)) : null, $lines, $notes, $onRequest);
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

// Shape of the JSON the booking page embeds for its script (built in BookingForm.astro from the data
// files). Type-only: the browser never imports src/lib/*.
import type { FormSchema } from '../../lib/form';

export interface BookingConfig {
  schema: FormSchema;
  /** settings.booking.endpoint, e.g. /api/book.php */
  endpoint: string;
  provider: 'php' | 'web3forms';
  /** Only filled when provider is web3forms (Web3Forms keys are public by design). */
  web3formsAccessKey: string;
  businessName: string;
  phoneE164: string;
  phoneDisplay: string;
  smsBody: string;
  email: string;
  /** "Estimate only — starting price before HST. Prices vary by location…" */
  estimateNote: string;
  /** "$100 deposit holds your date (50% for larger events), plus a $100 refundable security deposit" */
  depositLine: string;
  /** The same without the security deposit, for services that rent nothing (hampers). */
  depositLineBooking: string;
  taxNote: string;
  /** package id → "for 2 guests" */
  guestsLabels: Record<string, string>;
  thankYouUrl: string;
}

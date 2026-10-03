// Built to /api/form-schema.json. api/book.php reads it to validate submissions against
// exactly the questions the form shows — edit questions in src/content/booking-form.yaml only.
import type { APIRoute } from 'astro';
import { buildFormSchema } from '../../lib/form';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await buildFormSchema(), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

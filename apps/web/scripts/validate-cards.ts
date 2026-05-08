import { MARK_DOUGLAS_CARDS_SEED } from './data/cards';
import { cardCreateSchema } from '../src/lib/schemas/card';

let ok = 0;
let err = 0;
const errors: Array<{ slug: string; errors: string[] }> = [];

for (const c of MARK_DOUGLAS_CARDS_SEED) {
  const r = cardCreateSchema.safeParse(c);
  if (r.success) {
    ok++;
  } else {
    err++;
    errors.push({
      slug: c.slug,
      errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
}

console.log(`[validate-cards] Total: ${MARK_DOUGLAS_CARDS_SEED.length} | OK: ${ok} | ERR: ${err}`);
if (err > 0) {
  console.log(JSON.stringify(errors, null, 2));
  process.exit(1);
}
process.exit(0);

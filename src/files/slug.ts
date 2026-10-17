const MAX_SLUG = 60;

export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let slug = base.slice(0, MAX_SLUG).replace(/-+$/g, "");
  if (!slug) slug = "recipe";
  return slug;
}

/** Append -2, -3… until `exists` says the slug is free. */
export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  if (!exists(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`could not find a free slug for ${base}`);
}

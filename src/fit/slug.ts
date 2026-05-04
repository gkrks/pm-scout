/**
 * Slugify a string for use in filenames.
 *
 * - NFKD normalize (decompose accents)
 * - Strip combining marks
 * - Lowercase
 * - Replace runs of non-[a-z0-9] with _
 * - Trim leading/trailing _
 */
export function slug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Build the output basename for a generated resume.
 *
 * Format: Krithik_Gopinath_{company}_{role}.{ext}
 */
export function resumeBasename(
  companyName: string,
  roleName: string,
): string {
  const company = slug(companyName);
  const role = slug(roleName);
  if (!company || !role) {
    return `Krithik_Gopinath_${company || "unknown"}_${role || "unknown"}`;
  }
  return `Krithik_Gopinath_${company}_${role}`;
}

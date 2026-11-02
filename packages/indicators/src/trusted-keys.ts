/**
 * Public keys that may sign indicator bundles. Rotation: ship a release that trusts both the
 * old and the new key, sign with the new key, then drop the old key in a later release.
 * The matching private keys never enter the repository.
 */
export interface TrustedSigningKey {
  keyId: string;
  algorithm: "Ed25519";
  /** Raw 32-byte public key, base64. */
  publicKeyBase64: string;
  /** ISO date from which bundles signed by this key are accepted. */
  validFrom: string;
  note: string;
}

export const TRUSTED_SIGNING_KEYS: readonly TrustedSigningKey[] = [
  {
    keyId: "adtripwire-2026a",
    algorithm: "Ed25519",
    publicKeyBase64: "rRvnqqdkPjozDeDTxQIPWeXNbiBSuIyaRjwCn+jJDQ0=",
    validFrom: "2026-11-02",
    note: "Project indicator-bundle signing key, generated 2026-11-02.",
  },
];

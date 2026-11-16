/**
 * Disposable / throw-away email domains refused at signup (ADR-045).
 *
 * Source: a hand-curated subset of the widely known providers (10 Minute Mail, Guerrilla Mail, Mailinator,
 * Temp-Mail, YOPmail, Sharklasers and their common aliases). It is NOT complete and is not a security
 * boundary: new disposable domains appear daily. It removes the laziest abuse; the real controls are
 * mandatory verification, per-IP/per-email limits and per-account quotas. Extend the list in a PR or set
 * CHEMDFT_EXTRA_BLOCKED_EMAIL_DOMAINS (comma-separated) without a deploy of code.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com", "mailinator.net", "mailinator2.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamailblock.com", "sharklasers.com", "grr.la", "spam4.me", "pokemail.net",
  "10minutemail.com", "10minutemail.net", "10minutemail.co.uk", "20minutemail.com", "tempmail.com", "temp-mail.org",
  "temp-mail.io", "tempmail.net", "tempmailo.com", "tempr.email", "tempinbox.com", "throwawaymail.com", "trashmail.com",
  "trashmail.net", "trashmail.de", "trash-mail.com", "yopmail.com", "yopmail.net", "yopmail.fr", "cool.fr.nf", "jetable.org",
  "nospam.ze.tc", "dispostable.com", "getairmail.com", "getnada.com", "nada.email", "maildrop.cc", "mailnesia.com",
  "mintemail.com", "mohmal.com", "mytemp.email", "mailcatch.com", "fakeinbox.com", "fakemail.net", "emailondeck.com",
  "burnermail.io", "spamgourmet.com", "spambox.us", "spamex.com", "mailforspam.com", "discard.email", "discardmail.com",
  "dropmail.me", "moakt.com", "inboxkitten.com", "tmpmail.org", "tmpmail.net", "tmail.ws", "emailfake.com", "crazymailing.com",
  "harakirimail.com", "incognitomail.org", "mailtemp.net", "mail-temp.com", "owlymail.com", "wegwerfmail.de", "wegwerfmail.net",
  "einrot.com", "armyspy.com", "cuvox.de", "dayrep.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com",
  "superrito.com", "teleworm.us", "yopmail.gq", "byom.de", "mailbox92.biz", "33mail.com", "anonaddy.me",
];

export function isDisposableEmailDomain(domain: string, extra: string | undefined = process.env.CHEMDFT_EXTRA_BLOCKED_EMAIL_DOMAINS): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  const blocked = new Set([...DISPOSABLE_EMAIL_DOMAINS, ...(extra ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)]);
  // A subdomain of a blocked domain (x.mailinator.com) is blocked too.
  return [...blocked].some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

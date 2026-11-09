/**
 * Common misspellings of the email providers parents use, and what was meant. Used to catch a mistyped parent email
 * before it is linked to a child (a wrong email means the parent can never see their child).
 */
const FIXES: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gmaill.com": "gmail.com", "gmali.com": "gmail.com",
  "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com", "gmal.com": "gmail.com", "gmil.com": "gmail.com", "gmaol.com": "gmail.com", "gmail.cim": "gmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com", "yhoo.com": "yahoo.com", "yahho.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmail.co": "hotmail.com", "hotmal.com": "hotmail.com",
  "outlok.com": "outlook.com", "outllok.com": "outlook.com", "outlook.con": "outlook.com", "outlook.co": "outlook.com",
  "icloud.con": "icloud.com", "iclod.com": "icloud.com", "icoud.com": "icloud.com",
};

/** The corrected email when the domain is a known misspelling, otherwise null. */
export function emailTypoFix(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  const fix = FIXES[domain];
  return fix ? `${email.slice(0, at).trim().toLowerCase()}@${fix}` : null;
}

/**
 * Google sign-in and beta tester sign-up: the rules, the errors and the words. Pure, no I/O.
 *
 * Rules (docs/implementation/AUTH_ARCHITECTURE.md section 10):
 * 1. Default (closed): Google never creates a ChemDFT account. It signs in an existing account only
 *    when Google reports verified email and the address matches an existing account exactly.
 * 2. Google-only beta signup (Option B): New accounts may be created with Google only when verified
 *    by Google, under the global account cap, and with explicit Terms and Privacy acceptance.
 */

/** The callback path Better Auth serves for Google (base path `/api/auth` + `/callback/:id`). */
export const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";

export type GoogleSignupContext = { selfService?: boolean; googleOnly?: boolean };

type LocaleKey = "en" | "tr" | "ru" | "de";

const MESSAGES = {
  access_denied: {
    en: "Google sign-in was cancelled. Nothing was changed.",
    tr: "Google ile giriş iptal edildi. Hiçbir değişiklik yapılmadı.",
    ru: "Вход через Google был отменен. Никаких изменений не внесено.",
    de: "Google-Anmeldung wurde abgebrochen. Es wurden keine Änderungen vorgenommen.",
  },
  email_not_verified: {
    en: "Google has not verified this email address, so it cannot be used to sign in. Verify it with Google, or sign in with your email and password.",
    tr: "Google bu e-posta adresini doğrulamadı, bu nedenle giriş için kullanılamaz. Google ile doğrulayın veya e-posta ve şifrenizle giriş yapın.",
    ru: "Google не подтвердил этот адрес электронной почты, поэтому его нельзя использовать для входа. Подтвердите его в Google или войдите с помощью электронной почты и пароля.",
    de: "Google hat diese E-Mail-Adresse nicht bestätigt, daher kann sie nicht zur Anmeldung verwendet werden. Bestätigen Sie sie bei Google oder melden Sie sich mit E-Mail und Passwort an.",
  },
  beta_full: {
    en: "The ChemDFT beta is currently full. Accounts are limited during this test period.",
    tr: "ChemDFT betası şu anda dolu. Bu test döneminde hesaplar sınırlandırılmıştır.",
    ru: "Бета-версия ChemDFT сейчас заполнена. Количество аккаунтов на период тестирования ограничено.",
    de: "Die ChemDFT-Beta ist derzeit voll. Konten sind während dieses Testzeitraums begrenzt.",
  },
  terms_not_accepted: {
    en: "Accept the Terms of Use and Privacy Policy to create an account.",
    tr: "Hesap oluşturmak için Kullanım Koşulları ve Gizlilik Politikasını kabul edin.",
    ru: "Для создания аккаунта примите Условия использования и Политику конфиденциальности.",
    de: "Akzeptieren Sie die Nutzungsbedingungen und die Datenschutzrichtlinie, um ein Konto zu erstellen.",
  },
  account_disabled: {
    en: "This ChemDFT account has been disabled. Contact the owner for assistance.",
    tr: "Bu ChemDFT hesabı devre dışı bırakıldı. Yardım için yöneticiyle iletişime geçin.",
    ru: "Этот аккаунт ChemDFT отключен. Обратитесь к администратору.",
    de: "Dieses ChemDFT-Konto wurde deaktiviert. Wenden Sie sich an den Administrator.",
  },
  email_does_not_match: {
    en: "That Google account uses a different email address than your ChemDFT account, so it cannot be linked.",
    tr: "Bu Google hesabı, ChemDFT hesabınızdan farklı bir e-posta adresi kullanıyor, bu nedenle bağlanamaz.",
    ru: "Этот аккаунт Google использует другой адрес электронной почты, отличный от вашего аккаунта ChemDFT, поэтому его нельзя привязать.",
    de: "Dieses Google-Konto verwendet eine andere E-Mail-Adresse als Ihr ChemDFT-Konto und kann daher nicht verknüpft werden.",
  },
  account_already_linked_to_different_user: {
    en: "That Google account is already linked to another ChemDFT account.",
    tr: "Bu Google hesabı zaten başka bir ChemDFT hesabına bağlı.",
    ru: "Этот аккаунт Google уже привязан к другому аккаунту ChemDFT.",
    de: "Dieses Google-Konto ist bereits mit einem anderen ChemDFT-Konto verknüpft.",
  },
  closed: {
    en: "No ChemDFT account uses this Google address. Sign-up is closed: ask the owner for access, or sign in with your email and password.",
    tr: "Bu Google adresini kullanan ChemDFT hesabı bulunamadı. Kayıtlar kapalıdır: erişim için yöneticiyle iletişime geçin veya e-posta ve şifrenizle giriş yapın.",
    ru: "Нет аккаунта ChemDFT с этим адресом Google. Регистрация закрыта: обратитесь к администратору или войдите с помощью электронной почты и пароля.",
    de: "Kein ChemDFT-Konto verwendet diese Google-Adresse. Die Registrierung ist geschlossen: Bitten Sie den Administrator um Zugang oder melden Sie sich mit E-Mail und Passwort an.",
  },
  self_service_link: {
    en: "No ChemDFT account uses this Google address. Create an account with your email and password first, then link Google in Settings.",
    tr: "Bu Google adresini kullanan ChemDFT hesabı bulunamadı. Önce e-posta ve şifrenizle bir hesap oluşturun, ardından Ayarlar'dan Google'ı bağlayın.",
    ru: "Нет аккаунта ChemDFT с этим адресом Google. Сначала создайте аккаунт с электронной почтой и паролем, затем привяжите Google в Настройках.",
    de: "Kein ChemDFT-Konto verwendet diese Google-Adresse. Erstellen Sie zuerst ein Konto mit E-Mail und Passwort und verknüpfen Sie dann Google in den Einstellungen.",
  },
  google_only_failed: {
    en: "Sign-up with this Google account was not completed. Make sure you accept the terms and use a verified address.",
    tr: "Bu Google hesabıyla kayıt tamamlanamadı. Şartları kabul ettiğinizden ve doğrulanmış bir adres kullandığınızdan emin olun.",
    ru: "Регистрация с этим аккаунтом Google не была завершена. Убедитесь, что вы приняли условия и используете подтвержденный адрес.",
    de: "Die Registrierung mit diesem Google-Konto wurde nicht abgeschlossen. Stellen Sie sicher, dass Sie die Bedingungen akzeptieren und eine bestätigte Adresse verwenden.",
  },
  generic: {
    en: "Google sign-in did not complete. Nothing was changed. Try again, or sign in with your email and password.",
    tr: "Google ile giriş tamamlanamadı. Hiçbir değişiklik yapılmadı. Tekrar deneyin veya e-posta ve şifrenizle giriş yapın.",
    ru: "Вход через Google не был завершен. Никаких изменений не внесено. Попробуйте еще раз или войдите с помощью электронной почты и пароля.",
    de: "Die Google-Anmeldung konnte nicht abgeschlossen werden. Es wurden keine Änderungen vorgenommen. Versuchen Sie es erneut oder melden Sie sich mit E-Mail und Passwort an.",
  },
} as const satisfies Record<string, Record<LocaleKey, string>>;

function normalizeLocale(candidate?: string): LocaleKey {
  if (candidate === "tr" || candidate === "ru" || candidate === "de") return candidate;
  return "en";
}

/** Plain-language text for the `error` query parameter Better Auth puts on the login URL. Never echoes the raw code. */
export function plainGoogleError(
  code: string | null | undefined,
  context: GoogleSignupContext = { selfService: false },
  localeCandidate: string = "en",
): string | null {
  if (!code) return null;
  const loc = normalizeLocale(localeCandidate);
  const normalized = code.toLowerCase().trim();

  switch (normalized) {
    case "configuration":
      return null;
    case "access_denied":
    case "cancelled":
      return MESSAGES.access_denied[loc];
    case "email_not_verified":
    case "unverified":
      return MESSAGES.email_not_verified[loc];
    case "beta_full":
    case "cap_reached":
      return MESSAGES.beta_full[loc];
    case "terms_not_accepted":
      return MESSAGES.terms_not_accepted[loc];
    case "account_disabled":
      return MESSAGES.account_disabled[loc];
    case "email_does_not_match":
      return MESSAGES.email_does_not_match[loc];
    case "account_already_linked_to_different_user":
      return MESSAGES.account_already_linked_to_different_user[loc];
    case "account_not_linked":
    case "signup_disabled":
    case "email_not_found":
    case "closed":
      if (context.selfService) return MESSAGES.self_service_link[loc];
      if (context.googleOnly) return MESSAGES.google_only_failed[loc];
      return MESSAGES.closed[loc];
    default:
      return MESSAGES.generic[loc];
  }
}

/** Plain text for the failures of the Settings link/unlink calls. */
export function plainGoogleSettingsError(code: string | null | undefined): string {
  switch (code) {
    case "FAILED_TO_UNLINK_LAST_ACCOUNT":
      return "Google is your only way to sign in, so it cannot be unlinked. Set a password first.";
    case "ACCOUNT_NOT_FOUND":
      return "Google is not linked to this account.";
    case "SESSION_NOT_FRESH":
      return "For your safety, sign in again and then retry.";
    default:
      return "That did not work. Nothing was changed; try again.";
  }
}

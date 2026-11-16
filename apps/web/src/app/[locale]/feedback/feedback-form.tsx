"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { AppIcon } from "@chemdft/ui";

import {
  FEEDBACK_TYPES,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type FeedbackType,
} from "../../../lib/feedback/types";
import { formatAttachmentSize } from "../../../lib/feedback/format";
import styles from "./feedback.module.css";

interface FeedbackFormProps {
  locale: string;
  userEmail: string;
}

interface LocalAttachedFile {
  id: string;
  file: File;
  name: string;
  size: number;
}

type FormState = "idle" | "submitting" | "sent" | "error";

const I18N = {
  en: {
    pageTitle: "Tell us what ChemDFT should do next",
    pageSubtitle: "Every report goes straight to the team, and we read all of them.",
    typeLabel: "Report type",
    types: {
      not_working: "Not working",
      feature_idea: "Feature idea",
      method_or_engine: "Method or engine",
      other: "Other",
    },
    titleLabel: "Short title",
    titlePlaceholder: "Brief summary of what you are reporting...",
    detailsLabel: "Tell us more",
    detailsHint: "(what you did, expected, and saw; no length limit)",
    detailsPlaceholder: "Describe what you observed, what inputs or structures were involved, and what you expected to see...",
    attachLabel: "Attach files",
    attachHint: "(optional, up to 4 MB in total)",
    chooseFiles: "Choose files",
    orDrop: "or drop them here",
    cautionText:
      "Please do not attach unpublished or confidential data, or other people's personal data. Files are emailed to us, not stored on ChemDFT servers.",
    replyConsent: "The ChemDFT team may email me back about this report",
    accountEmailPrefix: "(your account email: ",
    agreesToPolicy: "Agrees to the",
    privacyPolicy: "Privacy Policy",
    sendButton: "Send feedback",
    sendingButton: "Sending...",
    rightTitle: "ChemDFT is an early-stage startup",
    rightBody:
      "We are building accessible computational chemistry for researchers: real DFT and related calculations, every result tied to its method and inputs, without the high price of commercial packages. It is free to use during the beta, for research. What you tell us decides what we build next.",
    whatNextTitle: "What happens next",
    step1: "It is emailed to the ChemDFT team, with your files.",
    step2: "We read it. Bugs come first.",
    step3: "Planned items go on the public roadmap, without your name.",
    seeRoadmap: "See the roadmap",
    autoNote: "Sent automatically with your report: the page you are on, ChemDFT version, language and your account.",
    thankTitle: "Thank you, we got it",
    sentDeliveredZero: "Your report was delivered to the ChemDFT team. We read everything.",
    sentDeliveredOne: "Your report and 1 attached file were delivered to the ChemDFT team. We read everything.",
    sentDeliveredMany: "Your report and {count} attached files were delivered to the ChemDFT team. We read everything.",
    mayWriteBack: " We may write back to {email}.",
    sendAnother: "Send another report",
    genericError:
      "We could not deliver your report. Nothing was lost: your text and files are still in the form. Please try again in a minute.",
    sizeError: "Total attachments exceed the 4 MB limit. Please remove some files.",
  },
  tr: {
    pageTitle: "ChemDFT'nin bundan sonra ne yapması gerektiğini bize iletin",
    pageSubtitle: "Her rapor doğrudan ekibe ulaşır ve hepsini okuruz.",
    typeLabel: "Rapor türü",
    types: {
      not_working: "Çalışmıyor",
      feature_idea: "Özellik fikri",
      method_or_engine: "Yöntem veya motor",
      other: "Diğer",
    },
    titleLabel: "Kısa başlık",
    titlePlaceholder: "Neyi bildirdiğinize dair kısa bir özet...",
    detailsLabel: "Daha fazla bilgi verin",
    detailsHint: "(ne yaptınız, ne beklediniz ve ne gördünüz; uzunluk sınırı yoktur)",
    detailsPlaceholder: "Ne gözlemlediğinizi, hangi girdilerin veya yapıların dahil olduğunu ve ne beklediğinizi açıklayın...",
    attachLabel: "Dosya ekle",
    attachHint: "(isteğe bağlı, toplamda 4 MB'a kadar)",
    chooseFiles: "Dosya seçin",
    orDrop: "veya buraya sürükleyin",
    cautionText:
      "Lütfen yayımlanmamış veya gizli verileri ya da başkalarının kişisel verilerini eklemeyin. Dosyalar bize e-posta ile gönderilir, ChemDFT sunucularında saklanmaz.",
    replyConsent: "ChemDFT ekibi bu raporla ilgili olarak bana e-posta ile geri dönebilir",
    accountEmailPrefix: "(hesap e-postanız: ",
    agreesToPolicy: "Kabul eder:",
    privacyPolicy: "Gizlilik Politikası",
    sendButton: "Geri bildirim gönder",
    sendingButton: "Gönderiliyor...",
    rightTitle: "ChemDFT erken aşama bir girişimdir",
    rightBody:
      "Araştırmacılar için erişilebilir hesaplamalı kimya inşa ediyoruz: gerçek DFT ve ilgili hesaplamalar, ticari paketlerin yüksek fiyatı olmadan her sonuç yöntemi ve girdileriyle bağlantılıdır. Beta süresince araştırma için kullanımı ücretsizdir. Bize söyledikleriniz bundan sonra ne inşa edeceğimizi belirler.",
    whatNextTitle: "Bundan sonra ne olacak",
    step1: "Dosyalarınızla birlikte ChemDFT ekibine e-posta ile gönderilir.",
    step2: "Okuyoruz. Hatalar önce gelir.",
    step3: "Planlanan öğeler, adınız olmadan herkese açık yol haritasına eklenir.",
    seeRoadmap: "Yol haritasını gör",
    autoNote: "Raporunuzla birlikte otomatik olarak gönderilir: bulunduğunuz sayfa, ChemDFT sürümü, dil ve hesabınız.",
    thankTitle: "Teşekkürler, aldık",
    sentDeliveredZero: "Raporunuz ChemDFT ekibine iletildi. Her şeyi okuyoruz.",
    sentDeliveredOne: "Raporunuz ve 1 ekli dosya ChemDFT ekibine iletildi. Her şeyi okuyoruz.",
    sentDeliveredMany: "Raporunuz ve {count} ekli dosya ChemDFT ekibine iletildi. Her şeyi okuyoruz.",
    mayWriteBack: " {email} adresine geri yazabiliriz.",
    sendAnother: "Başka bir rapor gönder",
    genericError:
      "Raporunuzu iletemedik. Hiçbir şey kaybolmadı: metniniz ve dosyalarınız hâlâ formda. Lütfen bir dakika içinde tekrar deneyin.",
    sizeError: "Toplam ek boyutu 4 MB sınırını aşıyor. Lütfen bazı dosyaları kaldırın.",
  },
  ru: {
    pageTitle: "Расскажите, что ChemDFT должен делать дальше",
    pageSubtitle: "Каждый отчет поступает напрямую команде, и мы читаем их все.",
    typeLabel: "Тип отчета",
    types: {
      not_working: "Не работает",
      feature_idea: "Идея функции",
      method_or_engine: "Метод или движок",
      other: "Другое",
    },
    titleLabel: "Краткий заголовок",
    titlePlaceholder: "Краткое описание отчета...",
    detailsLabel: "Расскажите подробнее",
    detailsHint: "(что вы сделали, ожидали и увидели; без ограничения длины)",
    detailsPlaceholder: "Опишите, что вы наблюдали, какие входные данные или структуры использовались, и что вы ожидали увидеть...",
    attachLabel: "Прикрепить файлы",
    attachHint: "(необязательно, всего до 4 МБ)",
    chooseFiles: "Выбрать файлы",
    orDrop: "или перетащите их сюда",
    cautionText:
      "Пожалуйста, не прикрепляйте неопубликованные или конфиденциальные данные, а также персональные данные других лиц. Файлы отправляются нам по электронной почте, а не хранятся на серверах ChemDFT.",
    replyConsent: "Команда ChemDFT может написать мне по электронной почте по поводу этого отчета",
    accountEmailPrefix: "(электронная почта вашей учетной записи: ",
    agreesToPolicy: "Соглашается с",
    privacyPolicy: "Политикой конфиденциальности",
    sendButton: "Отправить отзыв",
    sendingButton: "Отправка...",
    rightTitle: "ChemDFT — стартап на ранней стадии",
    rightBody:
      "Мы создаем доступную вычислительную химию для исследователей: реальные расчеты DFT и смежные методы, каждый результат привязан к своему методу и входным данным, без высоких цен коммерческих пакетов. В период бета-тестирования сервис бесплатен для исследований. То, что вы говорите нам, определяет, что мы создаем дальше.",
    whatNextTitle: "Что происходит дальше",
    step1: "Отправляется по электронной почте команде ChemDFT вместе с вашими файлами.",
    step2: "Мы читаем это. Ошибки на первом месте.",
    step3: "Запланированные пункты попадают в общедоступную дорожную карту без вашего имени.",
    seeRoadmap: "Посмотреть дорожную карту",
    autoNote: "Отправляется автоматически с вашим отчетом: страница, на которой вы находитесь, версия ChemDFT, язык и ваша учетная запись.",
    thankTitle: "Спасибо, мы получили",
    sentDeliveredZero: "Ваш отчет доставлен команде ChemDFT. Мы читаем всё.",
    sentDeliveredOne: "Ваш отчет и 1 прикрепленный файл доставлены команде ChemDFT. Мы читаем всё.",
    sentDeliveredMany: "Ваш отчет и {count} прикрепленных файлов доставлены команде ChemDFT. Мы читаем всё.",
    mayWriteBack: " Мы можем ответить на {email}.",
    sendAnother: "Отправить еще один отчет",
    genericError:
      "Не удалось доставить ваш отчет. Ничего не потеряно: ваш текст и файлы остались в форме. Пожалуйста, повторите попытку через минуту.",
    sizeError: "Общий размер файлов превышает предел 4 МБ. Пожалуйста, удалите некоторые файлы.",
  },
  de: {
    pageTitle: "Sagen Sie uns, was ChemDFT als Nächstes tun soll",
    pageSubtitle: "Jeder Bericht geht direkt an das Team, und wir lesen jeden einzelnen.",
    typeLabel: "Berichtstyp",
    types: {
      not_working: "Funktioniert nicht",
      feature_idea: "Funktionsidee",
      method_or_engine: "Methode oder Rechenprogramm",
      other: "Sonstiges",
    },
    titleLabel: "Kurzer Titel",
    titlePlaceholder: "Kurze Zusammenfassung Ihres Berichts...",
    detailsLabel: "Erzählen Sie uns mehr",
    detailsHint: "(was Sie getan haben, erwartet haben und sahen; keine Längenbegrenzung)",
    detailsPlaceholder: "Beschreiben Sie, was Sie beobachtet haben, welche Eingaben oder Strukturen beteiligt waren und was Sie erwartet haben...",
    attachLabel: "Dateien anhängen",
    attachHint: "(optional, insgesamt bis zu 4 MB)",
    chooseFiles: "Dateien auswählen",
    orDrop: "oder hierher ziehen",
    cautionText:
      "Bitte hängen Sie keine unveröffentlichten oder vertraulichen Daten oder personenbezogene Daten anderer Personen an. Dateien werden per E-Mail an uns gesendet und nicht auf ChemDFT-Servern gespeichert.",
    replyConsent: "Das ChemDFT-Team darf mir zu diesem Bericht eine E-Mail schreiben",
    accountEmailPrefix: "(Ihre Konto-E-Mail: ",
    agreesToPolicy: "Stimmt der",
    privacyPolicy: "Datenschutzerklärung",
    sendButton: "Feedback senden",
    sendingButton: "Wird gesendet...",
    rightTitle: "ChemDFT ist ein Start-up in der Frühphase",
    rightBody:
      "Wir entwickeln zugängliche Computerchemie für Forschende: echte DFT- und verwandte Berechnungen, jedes Ergebnis an Methode und Eingaben gebunden, ohne die hohen Kosten kommerzieller Softwarepakete. Während der Beta-Phase ist die Nutzung für Forschungszwecke kostenlos. Was Sie uns mitteilen, bestimmt, was wir als Nächstes bauen.",
    whatNextTitle: "Was als Nächstes passiert",
    step1: "Es wird mit Ihren Dateien per E-Mail an das ChemDFT-Team gesendet.",
    step2: "Wir lesen es. Fehlerbehebungen stehen an erster Stelle.",
    step3: "Geplante Punkte werden ohne Ihren Namen auf der öffentlichen Roadmap aufgeführt.",
    seeRoadmap: "Roadmap ansehen",
    autoNote: "Wird automatisch mit Ihrem Bericht gesendet: die Seite, auf der Sie sich befinden, ChemDFT-Version, Sprache und Ihr Konto.",
    thankTitle: "Vielen Dank, wir haben es erhalten",
    sentDeliveredZero: "Ihr Bericht wurde an das ChemDFT-Team zugestellt. Wir lesen alles.",
    sentDeliveredOne: "Ihr Bericht und 1 angehängte Datei wurden an das ChemDFT-Team zugestellt. Wir lesen alles.",
    sentDeliveredMany: "Ihr Bericht und {count} angehängte Dateien wurden an das ChemDFT-Team zugestellt. Wir lesen alles.",
    mayWriteBack: " Wir schreiben möglicherweise an {email} zurück.",
    sendAnother: "Einen weiteren Bericht senden",
    genericError:
      "Wir konnten Ihren Bericht nicht zustellen. Es ist nichts verloren gegangen: Ihr Text und Ihre Dateien befinden sich weiterhin im Formular. Bitte versuchen Sie es in einer Minute erneut.",
    sizeError: "Die Gesamtgröße der Anhänge überschreitet das 4-MB-Limit. Bitte entfernen Sie einige Dateien.",
  },
} as const;

export function FeedbackForm({ locale, userEmail }: FeedbackFormProps) {
  const t = I18N[locale as keyof typeof I18N] || I18N.en;
  const pathname = usePathname();

  const [type, setType] = useState<FeedbackType>("not_working");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [replyConsent, setReplyConsent] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<LocalAttachedFile[]>([]);
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalBytes = attachedFiles.reduce((acc, f) => acc + f.size, 0);
  const isOverSize = totalBytes > MAX_TOTAL_ATTACHMENT_BYTES;

  function handleFileSelection(files: FileList | null) {
    if (!files) return;
    setErrorMessage(null);
    const added: LocalAttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f && f.size > 0) {
        added.push({
          id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
          file: f,
          name: f.name,
          size: f.size,
        });
      }
    }
    setAttachedFiles((prev) => [...prev, ...added]);
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    handleFileSelection(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(id: string) {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFileSelection(e.dataTransfer.files);
  }

  function handleTypeKeyDown(e: KeyboardEvent<HTMLDivElement>, currentType: FeedbackType) {
    const currentIndex = FEEDBACK_TYPES.indexOf(currentType);
    let nextIndex = currentIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % FEEDBACK_TYPES.length;
      setType(FEEDBACK_TYPES[nextIndex]!);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + FEEDBACK_TYPES.length) % FEEDBACK_TYPES.length;
      setType(FEEDBACK_TYPES[nextIndex]!);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setType(currentType);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isOverSize) {
      setErrorMessage(t.sizeError);
      return;
    }
    if (!title.trim() || !details.trim()) {
      return;
    }

    setFormState("submitting");
    setErrorMessage(null);

    const formData = new FormData();
    formData.set("type", type);
    formData.set("title", title.trim());
    formData.set("details", details.trim());
    formData.set("replyConsent", replyConsent ? "true" : "false");
    formData.set("pagePath", pathname || "/feedback");
    formData.set("locale", locale);

    for (const item of attachedFiles) {
      formData.append("files", item.file, item.name);
    }

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        const msg = errorData.message || t.genericError;
        setErrorMessage(msg);
        setFormState("error");
        return;
      }

      setSentCount(attachedFiles.length);
      setFormState("sent");
    } catch {
      setErrorMessage(t.genericError);
      setFormState("error");
    }
  }

  function resetForm() {
    setTitle("");
    setDetails("");
    setAttachedFiles([]);
    setFormState("idle");
    setErrorMessage(null);
    setType("not_working");
    setReplyConsent(true);
  }

  // --- Success / Sent Screen ---
  if (formState === "sent") {
    let deliveryMessage: string = t.sentDeliveredZero;
    if (sentCount === 1) {
      deliveryMessage = t.sentDeliveredOne;
    } else if (sentCount > 1) {
      deliveryMessage = t.sentDeliveredMany.replace("{count}", String(sentCount));
    }

    const replyNotice = replyConsent ? t.mayWriteBack.replace("{email}", userEmail) : "";

    return (
      <div className={styles.container}>
        <section className={styles.sentCard} data-testid="feedback-sent-screen" aria-labelledby="sent-title">
          <div className={styles.sentIcon}>
            <AppIcon icon="tick-circle" />
          </div>
          <h1 id="sent-title" className={styles.sentTitle}>
            {t.thankTitle}
          </h1>
          <p className={styles.sentText}>
            {deliveryMessage}
            {replyNotice}
          </p>
          <div className={styles.sentActions}>
            <button
              type="button"
              className={`bp6-button bp6-intent-primary ${styles.sendButton}`}
              onClick={resetForm}
              data-testid="feedback-send-another"
            >
              {t.sendAnother}
            </button>
            <Link href={`/${locale}/roadmap`} className="bp6-button" data-testid="feedback-see-roadmap-btn">
              {t.seeRoadmap}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // --- Feedback Form Screen ---
  return (
    <div className={styles.container}>
      <div className={styles.titleLine}>
        <h1 className={styles.title}>{t.pageTitle}</h1>
        <span className={styles.titleMuted}>{t.pageSubtitle}</span>
      </div>

      <div className={styles.layout}>
        {/* Left Form Card */}
        <section className={styles.formCard} aria-label={t.pageTitle}>
          {errorMessage ? (
            <div role="alert" className={`bp6-callout bp6-intent-danger ${styles.alert}`} data-testid="feedback-error-alert">
              {errorMessage}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate>
            {/* a. Type selector */}
            <div className={styles.section}>
              <label id="feedback-type-label" className={styles.label}>
                {t.typeLabel}
              </label>
              <div
                role="radiogroup"
                aria-labelledby="feedback-type-label"
                className={styles.typeGroup}
              >
                {FEEDBACK_TYPES.map((ft) => {
                  const isSelected = type === ft;
                  return (
                    <div
                      key={ft}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => setType(ft)}
                      onKeyDown={(e) => handleTypeKeyDown(e, ft)}
                      className={`${styles.typeOption} ${isSelected ? styles.typeOptionSelected : ""}`}
                      data-testid={`feedback-type-${ft}`}
                    >
                      {isSelected ? (
                        <span className={styles.checkIcon} aria-hidden="true">
                          <AppIcon icon="tick" />
                        </span>
                      ) : null}
                      <span>{t.types[ft]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* b. Short title */}
            <div className={styles.section}>
              <label htmlFor="feedback-title" className={styles.label}>
                {t.titleLabel}
              </label>
              <input
                id="feedback-title"
                name="title"
                type="text"
                required
                maxLength={MAX_TITLE_LENGTH}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.titlePlaceholder}
                className={styles.input}
                data-testid="feedback-title-input"
              />
            </div>

            {/* c. Tell us more */}
            <div className={styles.section}>
              <label htmlFor="feedback-details" className={styles.label}>
                {t.detailsLabel}
                <span className={styles.labelHint}>{t.detailsHint}</span>
              </label>
              <textarea
                id="feedback-details"
                name="details"
                required
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t.detailsPlaceholder}
                className={styles.textarea}
                data-testid="feedback-details-textarea"
              />
            </div>

            {/* d. Attach files */}
            <div className={styles.section}>
              <label className={styles.label}>
                {t.attachLabel}
                <span className={styles.labelHint}>{t.attachHint}</span>
              </label>
              <div
                className={`${styles.dropZone} ${isDragOver ? styles.dropZoneActive : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-testid="feedback-drop-zone"
              >
                <div className={styles.dropActionRow}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={styles.chooseButton}
                    data-testid="feedback-choose-files-button"
                  >
                    {t.chooseFiles}
                  </button>
                  <span>{t.orDrop}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileInputChange}
                    className={styles.hiddenInput}
                    data-testid="feedback-file-input"
                  />
                </div>

                {attachedFiles.length > 0 ? (
                  <div className={styles.fileChips} data-testid="feedback-file-chips">
                    {attachedFiles.map((f) => (
                      <span key={f.id} className={styles.chip} data-testid="feedback-file-chip">
                        <span className={styles.chipName} title={f.name}>
                          {f.name}
                        </span>
                        <span className={styles.chipSize}>({formatAttachmentSize(f.size)})</span>
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          aria-label={`Remove ${f.name}`}
                          className={styles.chipRemove}
                          data-testid={`remove-file-${f.name}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* e. Amber caution line */}
            <div className={styles.cautionLine} role="note" data-testid="feedback-caution-line">
              <span className={styles.cautionIcon} aria-hidden="true">
                <AppIcon icon="warning-sign" />
              </span>
              <span>{t.cautionText}</span>
            </div>

            {/* f. Footer row */}
            <div className={styles.footerRow}>
              <div className={styles.footerLeft}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={replyConsent}
                    onChange={(e) => setReplyConsent(e.target.checked)}
                    className={styles.checkbox}
                    data-testid="feedback-reply-checkbox"
                  />
                  <span>
                    {t.replyConsent}
                    <span className={styles.emailMuted}>
                      {" "}
                      {t.accountEmailPrefix}
                      <strong>{userEmail}</strong>)
                    </span>
                  </span>
                </label>
                <div className={styles.privacyText}>
                  {t.agreesToPolicy}{" "}
                  <Link href={`/${locale}/privacy`} target="_blank" className={styles.privacyLink}>
                    {t.privacyPolicy}
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={formState === "submitting" || !title.trim() || !details.trim() || isOverSize}
                className={styles.sendButton}
                data-testid="feedback-send-button"
              >
                {formState === "submitting" ? t.sendingButton : t.sendButton}
              </button>
            </div>
          </form>
        </section>

        {/* Right Column */}
        <aside className={styles.rightColumn} aria-label="About ChemDFT">
          <div className={styles.infoBox} data-testid="feedback-startup-box">
            <h2 className={styles.infoTitle}>{t.rightTitle}</h2>
            <p className={styles.infoBody}>{t.rightBody}</p>
          </div>

          <div className={styles.nextBox} data-testid="feedback-what-next-box">
            <h2 className={styles.nextTitle}>{t.whatNextTitle}</h2>
            <ol className={styles.stepsList}>
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>
                {t.step3}{" "}
                <Link href={`/${locale}/roadmap`} className={styles.roadmapLink}>
                  {t.seeRoadmap}
                </Link>
              </li>
            </ol>
            <p className={styles.autoNote}>{t.autoNote}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

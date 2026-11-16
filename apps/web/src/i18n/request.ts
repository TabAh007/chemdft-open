import { defaultLocale, getMessages, isLocale } from "@chemdft/i18n";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const candidate = await requestLocale;
  const locale = candidate && isLocale(candidate) ? candidate : defaultLocale;
  return {
    locale,
    messages: getMessages(locale),
  };
});

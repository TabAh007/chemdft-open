import type { Locale } from "@chemdft/i18n";

import { Hero } from "./hero";
import { Process } from "./process";
import { StageCanvas } from "./stage";

/**
 * Acts I and II share one persistent 3D stage. On a wide screen the stage is `position: sticky` behind the flow, so the
 * same structure stays in place while the hero text scrolls away and the process story takes over; on a phone the
 * flow is flattened into reading order with the stage after the headline. Scrolling is always the browser's own.
 */
export function Journey({ locale }: { locale: Locale }) {
  return (
    <div className="journey" id="structure">
      <div className="journey-flow">
        <Hero locale={locale} />
        <Process />
      </div>
      <div className="stage">
        <StageCanvas />
      </div>
    </div>
  );
}

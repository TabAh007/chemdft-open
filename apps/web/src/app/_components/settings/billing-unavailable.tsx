import { AppIcon, StatusTag } from "@chemdft/ui";

import { SectionHead } from "./settings-shell";
import styles from "./settings.module.css";

/** Billing during the beta. A static page: it makes no request of any kind, so there is nothing to charge, create or read. */
export function BillingUnavailable() {
  return (
    <div data-testid="billing-panel" data-state="unavailable">
      <SectionHead title="Billing" tag={<StatusTag>Not available</StatusTag>} />
      <section className={`${styles.card} ${styles.greyed}`} style={{ marginTop: 22 }} aria-labelledby="billing-unavailable-heading">
        <div className={styles.cardBody}>
          <h3 id="billing-unavailable-heading" className={styles.unavailableMessage}>
            <AppIcon icon="info-sign" /> <span data-testid="billing-unavailable-message">Billing is not available during the beta. No charges are made.</span>
          </h3>
        </div>
      </section>
    </div>
  );
}

# Launch / legal decision memo

Selected PG: **NHN KCP**. KakaoPay and cards are payment methods behind KCP, not separate providers. Do not assume KakaoPay-direct credentials or a no-webhook model.

External boxes stay unchecked until written evidence exists.

- [ ] KCP written acceptance of one upfront charge + full cancellation/refund + transaction lookup/reconciliation
- [ ] KCP full-refund and settlement-timing confirmation in writing (partial refund is not required for MONEY V1)
- [ ] Acceptable iOS/native KCP integration path confirmed
- [ ] Apple External Purchase entitlement and commission/refund answer (not implemented)
- [ ] Lawyer confirmation of terms, cancellation cutoff, provisional FAIL, adult gate
- [ ] Tax-advisor confirmation of liability vs service-consideration reporting
- [ ] Telecom-sales / purchase-safety review
- [ ] Location-based-service filing
- [ ] Public terms / privacy / refund / support URLs live

Production MONEY remains fail-closed (`MONEY_ENABLED` defaults off in production). This is not a hidden App Review switch.

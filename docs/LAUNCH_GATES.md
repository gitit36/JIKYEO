# Launch gates

Single external checklist. Code must never mark a box complete automatically.

- [ ] KCP business-model accepted
- [ ] KCP merchant contract / Site Code / credentials available
- [ ] KCP full cancel/refund rules confirmed
- [ ] KCP status lookup/reconciliation confirmed
- [ ] KCP native-iOS path confirmed
- [ ] Apple payment classification confirmed
- [ ] StoreKit External Purchase Entitlement granted
- [ ] Apple commission/reporting implications confirmed
- [ ] lawyer review
- [ ] tax review
- [ ] telecom-sales / purchase-safety review
- [ ] LBS filing/review
- [ ] public pages actually deployed to HTTPS URLs
- [ ] production support/operator information filled
- [ ] APNs Auth Key (.p8) / Team ID / Key ID / topic available
- [ ] iOS Push Notifications capability + signed device for live APNs

Ordinary production MONEY is fail-closed. Mock payment is not live payment. Review/demo mock requires explicit `REVIEW_DEMO_MONEY=true` and must be labeled as not a real charge.

See `docs/MVP_FEATURE_MATRIX.md`, `docs/KCP_REVIEW.md`, `docs/APPLE_PAYMENT_REVIEW.md`.

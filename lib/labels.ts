import { Entry } from "./model";
export const kindNames: Record<Entry["kind"], string> = {
  purchase_funding: "Purchase funding",
  purchase_obligation: "Purchase on credit",
  sale: "Sale receipt",
  credit_sale: "Sale on credit",
  ownership_correction: "Ownership correction",
  expense: "Deal expense",
  funding_repayment: "Funding repayment",
  distribution: "Deal settlement / payout",
  payment: "General payment",
  on_behalf: "Paid on behalf",
  adjustment: "Balance adjustment",
  opening: "Opening debt",
  void: "Reversal",
};

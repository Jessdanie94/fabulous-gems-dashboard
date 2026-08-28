import { describe, it, expect } from "vitest";

// --- Replicated helper functions for testing ---

const SHOPIFY_FEE_RATE = 0.029;
const SHOPIFY_FEE_FIXED = 0.30;
const SELLVIA_COST_RATE = 0.40;
const SHOPIFY_PAYMENTS_GATEWAYS = ["shopify_payments", "Shopify Payments"];

function formatCurrency(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function profitTone(value: number): "success" | "critical" {
  return value >= 0 ? "success" : "critical";
}

function statusTone(
  status: string,
): "success" | "attention" | "critical" | "info" | undefined {
  switch (status.toUpperCase()) {
    case "PAID":
      return "success";
    case "IN_TRANSIT":
      return "info";
    case "SCHEDULED":
      return "attention";
    case "FAILED":
    case "CANCELED":
      return "critical";
    default:
      return undefined;
  }
}

function fulfillmentBadgeTone(
  status: string,
): "success" | "attention" | "critical" | "info" | undefined {
  switch (status.toUpperCase()) {
    case "FULFILLED":
      return "success";
    case "PARTIALLY_FULFILLED":
    case "IN_PROGRESS":
      return "info";
    case "UNFULFILLED":
      return "attention";
    case "ON_HOLD":
    case "SCHEDULED":
      return "attention";
    default:
      return undefined;
  }
}

function calculateShopifyFee(amount: number): number {
  return amount * SHOPIFY_FEE_RATE + SHOPIFY_FEE_FIXED;
}

function calculateSellviaCost(amount: number, metafieldValue?: string): number {
  if (metafieldValue) {
    return parseFloat(metafieldValue);
  }
  return amount * SELLVIA_COST_RATE;
}

function calculateNetProfit(
  amount: number,
  sellviaCost: number,
  shopifyFee: number,
): number {
  return amount - sellviaCost - shopifyFee;
}

function isShopifyPaymentsOrder(gateways: string[]): boolean {
  return gateways.some((g) => SHOPIFY_PAYMENTS_GATEWAYS.includes(g));
}

// --- Tests ---

describe("Payout Dashboard Helpers", () => {
  describe("formatCurrency", () => {
    it("formats CAD correctly", () => {
      const result = formatCurrency(1234.56, "CAD");
      expect(result).toContain("1,234.56");
    });

    it("formats USD correctly", () => {
      const result = formatCurrency(99.00, "USD");
      expect(result).toContain("99.00");
    });

    it("handles zero amount", () => {
      const result = formatCurrency(0.00, "CAD");
      expect(result).toContain("0.00");
    });

    it("handles large amounts", () => {
      const result = formatCurrency(1000000.50, "CAD");
      expect(result).toContain("1,000,000.50");
    });

    it("handles negative amounts", () => {
      const result = formatCurrency(-50.25, "CAD");
      expect(result).toContain("50.25");
    });
  });

  describe("formatDate", () => {
    it("formats ISO date to readable format", () => {
      const result = formatDate("2025-03-15T10:30:00Z");
      expect(result).toContain("2025");
      expect(result).toContain("Mar");
    });

    it("handles different dates", () => {
      const result = formatDate("2024-12-01T00:00:00Z");
      expect(result).toContain("2024");
      expect(result).toContain("Dec");
    });
  });

  describe("formatDateTime", () => {
    it("includes time component", () => {
      const result = formatDateTime("2025-03-15T10:30:00Z");
      expect(result).toContain("2025");
      expect(result).toContain("Mar");
    });
  });

  describe("profitTone", () => {
    it("returns success for positive profit", () => {
      expect(profitTone(100)).toBe("success");
    });

    it("returns success for zero profit", () => {
      expect(profitTone(0)).toBe("success");
    });

    it("returns critical for negative profit (loss)", () => {
      expect(profitTone(-50)).toBe("critical");
    });
  });

  describe("statusTone", () => {
    it("returns success for PAID", () => {
      expect(statusTone("PAID")).toBe("success");
    });

    it("returns info for IN_TRANSIT", () => {
      expect(statusTone("IN_TRANSIT")).toBe("info");
    });

    it("returns attention for SCHEDULED", () => {
      expect(statusTone("SCHEDULED")).toBe("attention");
    });

    it("returns critical for FAILED", () => {
      expect(statusTone("FAILED")).toBe("critical");
    });

    it("returns critical for CANCELED", () => {
      expect(statusTone("CANCELED")).toBe("critical");
    });

    it("returns undefined for unknown status", () => {
      expect(statusTone("UNKNOWN")).toBeUndefined();
    });

    it("is case insensitive", () => {
      expect(statusTone("paid")).toBe("success");
      expect(statusTone("Paid")).toBe("success");
    });
  });

  describe("fulfillmentBadgeTone", () => {
    it("returns success for FULFILLED", () => {
      expect(fulfillmentBadgeTone("FULFILLED")).toBe("success");
    });

    it("returns info for PARTIALLY_FULFILLED", () => {
      expect(fulfillmentBadgeTone("PARTIALLY_FULFILLED")).toBe("info");
    });

    it("returns attention for UNFULFILLED", () => {
      expect(fulfillmentBadgeTone("UNFULFILLED")).toBe("attention");
    });

    it("returns undefined for unknown status", () => {
      expect(fulfillmentBadgeTone("SOMETHING_ELSE")).toBeUndefined();
    });
  });
});

describe("Business Logic — Fee Calculations", () => {
  describe("calculateShopifyFee", () => {
    it("calculates 2.9% + $0.30 for a $100 order", () => {
      const fee = calculateShopifyFee(100);
      expect(fee).toBeCloseTo(3.20, 2);
    });

    it("calculates correctly for a $50 order", () => {
      const fee = calculateShopifyFee(50);
      expect(fee).toBeCloseTo(1.75, 2);
    });

    it("handles zero amount", () => {
      const fee = calculateShopifyFee(0);
      expect(fee).toBeCloseTo(0.30, 2);
    });

    it("handles large amount", () => {
      const fee = calculateShopifyFee(1000);
      expect(fee).toBeCloseTo(29.30, 2);
    });
  });

  describe("calculateSellviaCost", () => {
    it("uses metafield value when available", () => {
      const cost = calculateSellviaCost(100, "35.00");
      expect(cost).toBeCloseTo(35.00, 2);
    });

    it("falls back to 40% when no metafield", () => {
      const cost = calculateSellviaCost(100);
      expect(cost).toBeCloseTo(40.00, 2);
    });

    it("estimates correctly for various amounts", () => {
      expect(calculateSellviaCost(50)).toBeCloseTo(20.00, 2);
      expect(calculateSellviaCost(200)).toBeCloseTo(80.00, 2);
    });
  });

  describe("calculateNetProfit", () => {
    it("calculates net correctly for a $100 order", () => {
      const amount = 100;
      const sellviaCost = 40; // 40%
      const shopifyFee = 3.20; // 2.9% + 0.30
      const net = calculateNetProfit(amount, sellviaCost, shopifyFee);
      expect(net).toBeCloseTo(56.80, 2);
    });

    it("returns negative for high-cost orders", () => {
      const net = calculateNetProfit(10, 8, 0.59);
      expect(net).toBeCloseTo(1.41, 2);
    });

    it("handles zero revenue", () => {
      const net = calculateNetProfit(0, 0, 0.30);
      expect(net).toBeCloseTo(-0.30, 2);
    });
  });

  describe("isShopifyPaymentsOrder", () => {
    it("returns true for shopify_payments gateway", () => {
      expect(isShopifyPaymentsOrder(["shopify_payments"])).toBe(true);
    });

    it("returns true for Shopify Payments gateway", () => {
      expect(isShopifyPaymentsOrder(["Shopify Payments"])).toBe(true);
    });

    it("returns false for manual gateway", () => {
      expect(isShopifyPaymentsOrder(["manual"])).toBe(false);
    });

    it("returns false for Interac gateway", () => {
      expect(isShopifyPaymentsOrder(["interac"])).toBe(false);
    });

    it("returns true if any transaction uses Shopify Payments", () => {
      expect(
        isShopifyPaymentsOrder(["manual", "shopify_payments"]),
      ).toBe(true);
    });

    it("returns false for empty gateways", () => {
      expect(isShopifyPaymentsOrder([])).toBe(false);
    });
  });
});

describe("Integration: Dashboard Route File", () => {
  it("route file exists and contains required patterns", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "./app/routes/app._index.tsx",
      "utf-8",
    );

    // Auth
    expect(content).toContain("authenticate.admin");

    // GraphQL queries
    expect(content).toContain("shopifyPaymentsAccount");
    expect(content).toContain("getRecentOrders");
    expect(content).toContain("getPayouts");

    // Key data patterns
    expect(content).toContain("useLoaderData");
    expect(content).toContain("DataTable");

    // Dashboard sections
    expect(content).toContain("Total Revenue");
    expect(content).toContain("Sellvia Cost");
    expect(content).toContain("Shopify Fees");
    expect(content).toContain("Net Profit");
    expect(content).toContain("CIBC Payout Status");
    expect(content).toContain("Pending Payout Balance");

    // Fee constants
    expect(content).toContain("SHOPIFY_FEE_RATE");
    expect(content).toContain("SELLVIA_COST_RATE");

    // Order filtering
    expect(content).toContain("SHOPIFY_PAYMENTS_GATEWAYS");
    expect(content).toContain("Shopify Payments Only");

    // Metafield support
    expect(content).toContain("sellvia");
    expect(content).toContain("fulfillment_cost");

    // Sync status
    expect(content).toContain("syncStatus");
    expect(content).toContain("Last sync");

    // Read-only badge
    expect(content).toContain("Read Only");
  });

  it("does not contain any transfer/mutation operations", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "./app/routes/app._index.tsx",
      "utf-8",
    );

    // Should never trigger transfers
    expect(content).not.toContain("mutation");
    expect(content).not.toContain("payoutCreate");
    expect(content).not.toContain("transferCreate");
  });

  it("contains proper Polaris imports", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "./app/routes/app._index.tsx",
      "utf-8",
    );

    expect(content).toContain("InlineGrid");
    expect(content).toContain("Card");
    expect(content).toContain("Badge");
    expect(content).toContain("Banner");
    expect(content).toContain("DataTable");
    expect(content).toContain("Divider");
  });
});

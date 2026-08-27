import { describe, it, expect } from "vitest";

function formatCurrency(amount: string, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(parseFloat(amount));
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

describe("Payout Dashboard Helpers", () => {
  describe("formatCurrency", () => {
    it("formats USD correctly", () => {
      expect(formatCurrency("1234.56", "USD")).toBe("$1,234.56");
    });

    it("formats EUR correctly", () => {
      const result = formatCurrency("99.00", "EUR");
      expect(result).toContain("99.00");
    });

    it("handles zero amount", () => {
      expect(formatCurrency("0.00", "USD")).toBe("$0.00");
    });

    it("handles large amounts", () => {
      expect(formatCurrency("1000000.50", "USD")).toBe("$1,000,000.50");
    });
  });

  describe("formatDate", () => {
    it("formats ISO date to readable format", () => {
      const result = formatDate("2025-03-15T10:30:00Z");
      expect(result).toBe("Mar 15, 2025");
    });

    it("handles different dates", () => {
      const result = formatDate("2024-12-01T00:00:00Z");
      expect(result).toContain("2024");
      expect(result).toContain("Dec");
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
});

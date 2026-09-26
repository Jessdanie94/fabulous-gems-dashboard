/**
 * Sellvia API Service
 * Handles all API calls to Sellvia Analytics endpoints
 */

const SELLVIA_BASE_URL =
  process.env.SELLVIA_API_BASE_URL?.replace(/\/$/, "") || "https://api.sellvia.com";
const SELLVIA_ACCESS_KEY =
  process.env.SELLVIA_MASTER_KEY || process.env.SELLVIA_API_KEY;

interface SellviaAnalyticsResponse {
  data: {
    revenue?: number;
    orders?: number;
    average_order_value?: number;
    unique_visitors?: number;
    conversion_rate?: number;
    products?: Array<{
      id: string;
      name: string;
      revenue: number;
      units_sold: number;
    }>;
  };
}

async function fetchSellviaAnalytics<T>(pathname: string): Promise<T> {
  if (!SELLVIA_ACCESS_KEY) {
    throw new Error(
      "Missing Sellvia API credentials. Set SELLVIA_MASTER_KEY or SELLVIA_API_KEY.",
    );
  }

  const response = await fetch(`${SELLVIA_BASE_URL}${pathname}`, {
    method: "GET",
    headers: {
      Authorization: ["Bearer", SELLVIA_ACCESS_KEY].join(" "),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Sellvia API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/**
 * Get store revenue summary
 */
export async function getRevenueMetrics(
  timeframe: "today" | "week" | "month" | "year" = "month",
) {
  try {
    const data = await fetchSellviaAnalytics<SellviaAnalyticsResponse>(
      `/analytics/revenue?timeframe=${timeframe}`,
    );
    return data.data;
  } catch (error) {
    console.error("Error fetching Sellvia revenue metrics:", error);
    throw error;
  }
}

/**
 * Get top performing products
 */
export async function getTopProducts(limit: number = 10) {
  try {
    const data = await fetchSellviaAnalytics<SellviaAnalyticsResponse>(
      `/analytics/products?limit=${limit}&sort=revenue`,
    );
    return data.data.products || [];
  } catch (error) {
    console.error("Error fetching Sellvia top products:", error);
    throw error;
  }
}

/**
 * Get order analytics
 */
export async function getOrderAnalytics(
  timeframe: "today" | "week" | "month" | "year" = "month",
) {
  try {
    const data = await fetchSellviaAnalytics<SellviaAnalyticsResponse>(
      `/analytics/orders?timeframe=${timeframe}`,
    );
    return data.data;
  } catch (error) {
    console.error("Error fetching Sellvia order analytics:", error);
    throw error;
  }
}

/**
 * Get customer analytics
 */
export async function getCustomerAnalytics(
  timeframe: "today" | "week" | "month" | "year" = "month",
) {
  try {
    const data = await fetchSellviaAnalytics<SellviaAnalyticsResponse>(
      `/analytics/customers?timeframe=${timeframe}`,
    );
    return data.data;
  } catch (error) {
    console.error("Error fetching Sellvia customer analytics:", error);
    throw error;
  }
}

/**
 * Get comprehensive dashboard data
 */
export async function getDashboardData() {
  try {
    const [revenue, orders, products, customers] = await Promise.all([
      getRevenueMetrics("month"),
      getOrderAnalytics("month"),
      getTopProducts(5),
      getCustomerAnalytics("month"),
    ]);

    return {
      revenue,
      orders,
      products,
      customers,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching Sellvia dashboard data:", error);
    throw error;
  }
}

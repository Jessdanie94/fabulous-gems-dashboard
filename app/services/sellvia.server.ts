/**
 * Sellvia API Service
 * Handles all API calls to Sellvia Analytics endpoints
 */

const SELLVIA_BASE_URL = "https://api.sellvia.com";
const SELLVIA_MASTER_KEY = process.env.SELLVIA_MASTER_KEY;

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

/**
 * Get store revenue summary
 */
export async function getRevenueMetrics(
  timeframe: "today" | "week" | "month" | "year" = "month"
) {
  try {
    const response = await fetch(
      `${SELLVIA_BASE_URL}/analytics/revenue?timeframe=${timeframe}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SELLVIA_MASTER_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Sellvia API error: ${response.statusText}`);
    }

    const data = (await response.json()) as SellviaAnalyticsResponse;
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
    const response = await fetch(
      `${SELLVIA_BASE_URL}/analytics/products?limit=${limit}&sort=revenue`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SELLVIA_MASTER_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Sellvia API error: ${response.statusText}`);
    }

    const data = (await response.json()) as SellviaAnalyticsResponse;
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
  timeframe: "today" | "week" | "month" | "year" = "month"
) {
  try {
    const response = await fetch(
      `${SELLVIA_BASE_URL}/analytics/orders?timeframe=${timeframe}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SELLVIA_MASTER_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Sellvia API error: ${response.statusText}`);
    }

    const data = (await response.json()) as SellviaAnalyticsResponse;
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
  timeframe: "today" | "week" | "month" | "year" = "month"
) {
  try {
    const response = await fetch(
      `${SELLVIA_BASE_URL}/analytics/customers?timeframe=${timeframe}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SELLVIA_MASTER_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Sellvia API error: ${response.statusText}`);
    }

    const data = (await response.json()) as SellviaAnalyticsResponse;
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

import type { Connector, ConnectorContext, ConnectorOutput } from '../../types/core.ts';
import { env } from '../../config/env.ts';
import { fetchJson } from '../../services/sync/http.ts';
import { isoDateInTimezone, normalizeCurrency, normalizeOrderStatus, stableKey, toNumberOrNull } from '../../services/normalization/index.ts';

function headers() {
  return {
    Authorization: env.zidAuthorizationToken,
    'X-Manager-Token': env.zidManagerToken,
    'Access-Token': env.zidManagerToken,
    'Store-Id': env.zidStoreId,
    Role: 'Manager',
    'Accept-Language': 'en',
  };
}

function pick(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) cur = cur?.[p];
    if (cur !== undefined && cur !== null) return cur;
  }
  return null;
}

export class ZidConnector implements Connector {
  readonly name = 'zid' as const;

  async testConnection() {
    const data = await fetchJson(`${env.zidBaseUrl}/managers/store/orders?page=1&per_page=1&payload_type=simple`, { headers: headers() });
    return { ok: Array.isArray(data?.orders) || Array.isArray(data?.results), detail: 'Zid orders endpoint reachable' };
  }

  async fetch(ctx: ConnectorContext): Promise<ConnectorOutput> {
    if (ctx.mock) return this.mock(ctx);
    const warnings: string[] = [];
    const orders: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await fetchJson(`${env.zidBaseUrl}/managers/store/orders?page=${page}&per_page=100&payload_type=simple`, { headers: headers() });
      const batch = data?.orders || data?.results || [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      orders.push(...batch);
      if (batch.length < 100) break;
    }

    const productData = await fetchJson(`${env.zidBaseUrl}/products/?page=1&page_size=100`, { headers: headers() });
    const products = productData?.results || productData?.products || [];

    const orderRows = orders
      .filter((o: any) => {
        const rawDate = pick(o, ['updated_at','created_at','order_date.date','date']);
        if (!rawDate) return true;
        const d = new Date(String(rawDate));
        return Number.isNaN(d.getTime()) || (d >= ctx.window.start && d <= ctx.window.end);
      })
      .map((o: any) => {
        const dateRaw = pick(o, ['updated_at','created_at','order_date.date','date']) || ctx.window.end;
        const revenue = toNumberOrNull(pick(o, ['order_total','total','total.value','grand_total','total_price']));
        const discount = toNumberOrNull(pick(o, ['discount','discount_amount','discounts.total']));
        const shipping = toNumberOrNull(pick(o, ['shipping_cost','shipping.amount','shipping_fee']));
        const tax = toNumberOrNull(pick(o, ['tax','tax_amount','vat_amount']));
        const net = revenue === null ? null : revenue - (discount ?? 0);
        return {
          record_type: 'order',
          key: stableKey(['order', o.id ?? o.order_id ?? o.code]),
          date: isoDateInTimezone(dateRaw),
          order_id: String(o.id ?? o.order_id ?? o.code ?? ''),
          status: normalizeOrderStatus(pick(o, ['order_status.name','status.name','status'])),
          revenue,
          net_sales: net,
          discount,
          shipping,
          tax,
          currency: normalizeCurrency(pick(o, ['currency.code','currency','order_currency']), 'SAR'),
          branch: pick(o, ['branch.name','inventory.name','source.name','store_name']),
          channel: pick(o, ['source','channel','order_source']),
          quantity: null,
          product_id: null,
          sku: null,
          product_name: null,
          available_quantity: null,
          critical_stock: null,
        };
      });

    const stockRows: Record<string, unknown>[] = [];
    if (Array.isArray(products)) {
      for (const p of products.slice(0, 300)) {
        const pid = p.id ?? p.product_id;
        if (!pid) continue;
        let stocks: any[] = [];
        try {
          const s = await fetchJson(`${env.zidBaseUrl}/products/${pid}/stocks/`, { headers: headers() });
          stocks = s?.results || s?.stocks || [];
        } catch {
          warnings.push(`تعذر جلب مخزون المنتج ${pid}`);
        }
        if (!stocks.length) {
          stockRows.push({
            record_type: 'stock', key: stableKey(['stock', pid, 'default']), date: isoDateInTimezone(ctx.window.end),
            order_id: null, status: null, revenue: null, net_sales: null, discount: null, shipping: null, tax: null,
            currency: 'SAR', branch: null, channel: null, quantity: toNumberOrNull(p.quantity), product_id: String(pid), sku: p.sku ?? null,
            product_name: p.name?.ar ?? p.name?.en ?? p.name ?? null, available_quantity: toNumberOrNull(p.quantity), critical_stock: null,
          });
        } else {
          for (const s of stocks) {
            const q = toNumberOrNull(s.available_quantity);
            stockRows.push({
              record_type: 'stock', key: stableKey(['stock', pid, s.location?.id ?? s.id]), date: isoDateInTimezone(ctx.window.end),
              order_id: null, status: null, revenue: null, net_sales: null, discount: null, shipping: null, tax: null,
              currency: 'SAR', branch: s.location?.name ?? null, channel: null, quantity: q, product_id: String(pid), sku: p.sku ?? null,
              product_name: p.name?.ar ?? p.name?.en ?? p.name ?? null, available_quantity: q, critical_stock: q === null ? null : q <= 3,
            });
          }
        }
      }
    }
    return { source: this.name, rows: [...orderRows, ...stockRows], pulled: orders.length + (Array.isArray(products) ? products.length : 0), warnings };
  }

  private mock(ctx: ConnectorContext): ConnectorOutput {
    const d = isoDateInTimezone(ctx.window.end);
    return { source: this.name, pulled: 3, warnings: ['MOCK_DATA'], rows: [
      { record_type:'order', key:'order|mock-1', date:d, order_id:'mock-1', status:'completed', revenue:199, net_sales:189, discount:10, shipping:0, tax:25.96, currency:'SAR', branch:'MOCK', channel:'online', quantity:null, product_id:null, sku:null, product_name:null, available_quantity:null, critical_stock:null },
      { record_type:'order', key:'order|mock-2', date:d, order_id:'mock-2', status:'cancelled', revenue:99, net_sales:99, discount:0, shipping:20, tax:12.91, currency:'SAR', branch:'MOCK', channel:'online', quantity:null, product_id:null, sku:null, product_name:null, available_quantity:null, critical_stock:null },
      { record_type:'stock', key:'stock|mock-product|mock-branch', date:d, order_id:null, status:null, revenue:null, net_sales:null, discount:null, shipping:null, tax:null, currency:'SAR', branch:'MOCK', channel:null, quantity:2, product_id:'mock-product', sku:'MOCK-SKU', product_name:'منتج تجريبي', available_quantity:2, critical_stock:true },
    ]};
  }
}

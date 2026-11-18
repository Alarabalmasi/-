import type { Connector, ConnectorContext, ConnectorOutput } from '../../types/core.ts';
import { env } from '../../config/env.ts';
import { fetchJson } from '../../services/sync/http.ts';
import { isoDateInTimezone, normalizeCurrency, normalizeOrderStatus, stableKey, toNumberOrNull } from '../../services/normalization/index.ts';

function authorizationHeader() {
  return /^Bearer\s/i.test(env.zidAuthorizationToken)
    ? env.zidAuthorizationToken
    : `Bearer ${env.zidAuthorizationToken}`;
}

function orderHeaders() {
  return {
    Authorization: authorizationHeader(),
    'X-Manager-Token': env.zidManagerToken,
    'Accept-Language': 'en',
  };
}

function productHeaders() {
  return {
    Authorization: authorizationHeader(),
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
    const data = await fetchJson(`${env.zidBaseUrl}/managers/store/orders?page=1&per_page=1&payload_type=simple`, { headers: orderHeaders() });
    return { ok: Array.isArray(data?.orders) || Array.isArray(data?.results), detail: 'Zid orders endpoint reachable' };
  }

  async fetch(ctx: ConnectorContext): Promise<ConnectorOutput> {
    if (ctx.mock) return this.mock(ctx);
    const warnings: string[] = [];
    const orders: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await fetchJson(`${env.zidBaseUrl}/managers/store/orders?page=${page}&per_page=100&payload_type=simple`, { headers: orderHeaders() });
      const batch = data?.orders || data?.results || [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      orders.push(...batch);
      if (batch.length < 100) break;
    }

    // Fetch every page. A single page silently excluded products once the catalog exceeded 100 items.
    const products: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const productData = await fetchJson(`${env.zidBaseUrl}/products/?page=${page}&page_size=100`, { headers: productHeaders() });
      const batch = productData?.results || productData?.products || [];
      if (!Array.isArray(batch)) throw new Error('Zid products API returned an unexpected response.');
      products.push(...batch);
      if (batch.length < 100) break;
      if (page === 100) warnings.push('Zid product pagination reached the safety cap of 100 pages.');
    }

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
    // Zid's parent product stock endpoint can be empty while its variants are stocked.
    // Resolve the product details and record each actual variant/location combination.
    for (const p of products) {
      const pid = p.id ?? p.product_id;
      if (!pid) continue;
      const detail = await fetchJson(`${env.zidBaseUrl}/products/${pid}/`, { headers: productHeaders() });
      const variants = Array.isArray(detail?.variants) ? detail.variants : [];
      const items = variants.length ? variants : [detail];
      for (const item of items) {
        const itemId = item.id ?? pid;
        let stocks = Array.isArray(item.stocks) ? item.stocks : [];
        if (!stocks.length) {
          const stockData = await fetchJson(`${env.zidBaseUrl}/products/${itemId}/stocks/`, { headers: productHeaders() });
          stocks = stockData?.results || stockData?.stocks || [];
          if (!Array.isArray(stocks)) throw new Error(`Invalid stock records for product ${itemId}`);
        }
        if (!stocks.length) {
          warnings.push(`لا توجد سجلات مخزون قابلة للتحقق للمتغير ${itemId}`);
          continue;
        }
        for (const stock of stocks) {
          const locationId = stock.location?.id ?? '';
          if (!locationId) {
            warnings.push(`مخزون بلا معرف مستودع للمتغير ${itemId}`);
            continue;
          }
          const infinite = stock.is_infinite === true;
          const quantity = infinite ? null : toNumberOrNull(stock.available_quantity);
          if (!infinite && quantity === null) {
            warnings.push(`كمية غير معروفة للمتغير ${itemId} في ${locationId}`);
            continue;
          }
          stockRows.push({
            record_type: 'stock',
            key: stableKey(['stock', itemId, locationId]),
            date: isoDateInTimezone(ctx.window.end),
            order_id: null, status: null, revenue: null, net_sales: null,
            discount: null, shipping: null, tax: null, currency: 'SAR',
            branch: stock.location?.name?.ar ?? stock.location?.name?.en ?? stock.location?.name ?? null,
            channel: null,
            quantity,
            product_id: String(itemId),
            sku: item.sku ?? p.sku ?? null,
            product_name: item.name?.ar ?? item.name?.en ?? item.name ?? p.name?.ar ?? p.name?.en ?? null,
            available_quantity: quantity,
            critical_stock: infinite ? false : quantity <= 3,
          });
        }
      }
    }
    if (stockRows.length === 0) throw new Error('No verified variant-level inventory rows. Refusing an empty inventory sync.');
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

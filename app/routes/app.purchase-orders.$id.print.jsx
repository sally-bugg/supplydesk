import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request, params }) {
  await authenticate.admin(request);
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: { lines: { include: { material: true } } },
  });
  if (!po) throw new Response("Not Found", { status: 404 });
  return json({ po });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;
const poRef = (po) => `PO-${po.id.slice(-6).toUpperCase()}`;

export default function POPrint() {
  const { po } = useLoaderData();
  const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{poRef(po)} — Purchase Order</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; color: #1a1a1a; background: #fff; padding: 48px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #1a1a1a; }
          .header-left h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
          .header-left p { color: #666; margin-top: 4px; font-size: 13px; }
          .header-right { text-align: right; }
          .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
          .status.draft { background: #fff3cd; color: #856404; }
          .status.received { background: #d1e7dd; color: #0a3622; }
          .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 36px; }
          .meta-item label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; display: block; margin-bottom: 4px; }
          .meta-item span { font-size: 15px; font-weight: 500; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          thead th { background: #f8f8f8; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #555; border-bottom: 1px solid #e0e0e0; }
          thead th:last-child { text-align: right; }
          tbody td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
          tbody td:last-child { text-align: right; font-weight: 600; }
          tbody tr:last-child td { border-bottom: none; }
          .total-row { display: flex; justify-content: flex-end; margin-top: 8px; }
          .total-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 20px; min-width: 220px; display: flex; justify-content: space-between; align-items: center; }
          .total-box .label { font-size: 13px; color: #555; }
          .total-box .amount { font-size: 20px; font-weight: 700; }
          .notes { margin-top: 32px; padding: 16px; background: #f8f8f8; border-radius: 6px; border-left: 3px solid #1a1a1a; }
          .notes label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; display: block; margin-bottom: 6px; }
          .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; color: #aaa; font-size: 12px; }
          .print-btn { position: fixed; top: 20px; right: 20px; background: #1a1a1a; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 999; }
          .print-btn:hover { background: #333; }
          @media print {
            body { padding: 24px; }
            .print-btn { display: none; }
            @page { margin: 20mm; }
          }
        `}</style>
      </head>
      <body>
        <button className="print-btn" onClick={() => window.print()}>Download PDF</button>

        <div className="header">
          <div className="header-left">
            <h1>Purchase Order</h1>
            <p>Reference: {poRef(po)}</p>
          </div>
          <div className="header-right">
            <span className={`status ${po.status}`}>{po.status === "received" ? "Received" : "Draft"}</span>
            <p style={{ marginTop: "8px", color: "#666", fontSize: "13px" }}>SupplyDesk</p>
          </div>
        </div>

        <div className="meta">
          <div className="meta-item">
            <label>Supplier</label>
            <span>{po.supplier || "—"}</span>
          </div>
          <div className="meta-item">
            <label>Date Created</label>
            <span>{new Date(po.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
          <div className="meta-item">
            <label>{po.status === "received" ? "Date Received" : "Status"}</label>
            <span>{po.receivedAt ? new Date(po.receivedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) : "Pending"}</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Material</th>
              <th>SKU</th>
              <th>Unit</th>
              <th style={{ textAlign: "right" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Unit Cost</th>
              <th style={{ textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={l.id}>
                <td style={{ color: "#888", width: "32px" }}>{i + 1}</td>
                <td style={{ fontWeight: 500 }}>{l.material.name}</td>
                <td style={{ color: "#888", fontFamily: "monospace" }}>{l.material.sku}</td>
                <td style={{ color: "#666" }}>{l.material.unit}</td>
                <td style={{ textAlign: "right" }}>{l.qty}</td>
                <td style={{ textAlign: "right" }}>{fmt(l.cost)}</td>
                <td>{fmt(l.qty * l.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="total-row">
          <div className="total-box">
            <span className="label">Order Total</span>
            <span className="amount">{fmt(total)}</span>
          </div>
        </div>

        {po.note && (
          <div className="notes">
            <label>Notes</label>
            <p>{po.note}</p>
          </div>
        )}

        <div className="footer">
          <span>Generated by SupplyDesk</span>
          <span>{new Date().toLocaleString()}</span>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          // Auto-trigger print dialog if ?print=1 is in URL
          if (new URLSearchParams(window.location.search).get('print') === '1') {
            window.onload = () => window.print();
          }
        `}} />
      </body>
    </html>
  );
}

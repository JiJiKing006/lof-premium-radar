(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const n of a)if(n.type==="childList")for(const c of n.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&s(c)}).observe(document,{childList:!0,subtree:!0});function r(a){const n={};return a.integrity&&(n.integrity=a.integrity),a.referrerPolicy&&(n.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?n.credentials="include":a.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function s(a){if(a.ep)return;a.ep=!0;const n=r(a);fetch(a.href,n)}})();const m=document.querySelector("#app"),i={query:"",stance:"all",sortKey:"rank",sortDirection:"asc",rows:[],meta:null},y=[{key:"security",label:"代码 / 名称 / 限购",type:"text",sticky:!0},{key:"price",label:"价格",type:"number"},{key:"change",label:"涨幅",type:"number",mode:"quote"},{key:"quoteDate",label:"日期",type:"date"},{key:"quoteTime",label:"时间",type:"text"},{key:"officialEst",label:"官方EST",type:"number"},{key:"estDate",label:"EST日期",type:"date"},{key:"officialPremium",label:"溢价",type:"number",mode:"premium"},{key:"referenceEst",label:"参考EST",type:"number"},{key:"referencePremium",label:"溢价",type:"number",mode:"premium"},{key:"realtimeEst",label:"实时EST",type:"number"},{key:"realtimePremium",label:"溢价",type:"number",mode:"premium"}],v=new Set(["price","change","officialPremium","referencePremium","realtimePremium"]);function h(t){const e=Number.parseFloat(String(t??"").replace("%",""));return Number.isNaN(e)?null:e}function l(t,e){const r=e==="price"?t.change:t[e],s=h(r);if(s==null)return"is-empty";if(e==="price"||e==="change"){if(s>0)return"market-up";if(s<0)return"market-down"}else{if(s<0)return"est-red";if(s>0)return"est-green"}return"is-flat"}function u(t){return t===""||t==null?"—":t}function k(t){return t?new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(t)):""}function T(){const t=window.location.hash.match(/^#\/detail\/([^/]+)$/);return t?{page:"detail",code:decodeURIComponent(t[1])}:{page:"home"}}function $(t,e){if(e==="security")return`${t.code} ${t.name}`;if(e==="rank")return t.rank;const r=y.find(s=>s.key===e);return(r==null?void 0:r.type)==="number"?t[`${e}Value`]??h(t[e])??Number.NaN:((r==null?void 0:r.type)==="date",t[e]||"")}function S(){const t=i.query.trim().toLowerCase();return i.rows.filter(r=>{const s=!t||r.code.toLowerCase().includes(t)||r.name.toLowerCase().includes(t),a=r.officialPremiumValue,n=i.stance==="all"||i.stance==="discount"&&a<0||i.stance==="premium"&&a>0||i.stance==="live"&&r.realtimePremiumValue!=null;return s&&n}).sort((r,s)=>{const a=$(r,i.sortKey),n=$(s,i.sortKey),c=i.sortDirection==="asc"?1:-1;if(typeof a=="number"||typeof n=="number"){const d=Number.isNaN(a)?Number.POSITIVE_INFINITY:a,E=Number.isNaN(n)?Number.POSITIVE_INFINITY:n;return(d-E)*c||r.rank-s.rank}return String(a).localeCompare(String(n),"zh-CN")*c||r.rank-s.rank})}function L(t){const e=t.map(n=>n.officialPremiumValue).filter(n=>n!=null),r=t.filter(n=>n.realtimePremiumValue!=null).length,s=Math.min(...e),a=Math.max(...e);return{min:s,max:a,liveCount:r}}function g(t){return i.sortKey!==t?"↕":i.sortDirection==="asc"?"↑":"↓"}function N(t){return`
    <th class="${t.sticky?"security-col":""}">
      <button class="sort-head" type="button" data-sort-key="${t.key}" aria-label="按${t.label}排序">
        <span>${t.label.replace("EST","<strong>EST</strong>")}</span>
        <em>${g(t.key)}</em>
      </button>
    </th>
  `}function P(t,e){var s;if(e.key==="security"){const a=t.purchaseLimit||{},n=(s=a.status)!=null&&s.includes("暂停")?"limit-paused":a.limited?"limit-capped":"limit-open";return`
      <td class="security-col">
        <a class="security-link" href="#/detail/${encodeURIComponent(t.code)}">
          <strong>${t.code}</strong>
          <span>${t.name}</span>
          <small class="${n}">
            ${u(a.limitText)}
            ${a.accountScope?`<em>${a.accountScope}</em>`:""}
          </small>
        </a>
      </td>
    `}const r=v.has(e.key)?l(t,e.key):"";return`<td data-key="${e.key}" class="${r}">${u(t[e.key])}</td>`}function C(t){return`
    <tr style="--row-index:${t.rank}">
      ${y.map(e=>P(t,e)).join("")}
    </tr>
  `}function p(t,e="LOF基金"){var s;const r=L(i.rows);return`
    <main class="shell">
      <header class="market-head" aria-labelledby="page-title">
        <div class="ticker-title">
          <span class="market-dot"></span>
          <h1 id="page-title">${e}</h1>
        </div>
      <div class="market-stats" aria-label="数据摘要">
        <span>📊 ${((s=i.meta)==null?void 0:s.rowCount)||0} 项</span>
        <span>🟢 低 ${r.min.toFixed(2)}%</span>
        <span>🔴 高 ${r.max.toFixed(2)}%</span>
        <span>⚡ 实时 ${r.liveCount}</span>
        </div>
      </header>
      <div class="ticker-ribbon" aria-hidden="true">
        <div>
          LOF PREMIUM RADAR · TAP A ROW FOR DETAIL · EST / LIVE / REFERENCE ·
          LOF PREMIUM RADAR · TAP A ROW FOR DETAIL · EST / LIVE / REFERENCE ·
        </div>
      </div>
      ${t}
    </main>
  `}function f(){var r,s,a;const t=S(),e=k((r=i.meta)==null?void 0:r.scrapedAt);m.innerHTML=p(`
    <section class="intro-strip">
      <p><strong>EST</strong>网页链接共${((s=i.meta)==null?void 0:s.rowCount)||0}项按官方<strong>溢价</strong>排序</p>
      <div class="source-links">
        <a href="${((a=i.meta)==null?void 0:a.sourceUrl)||"#"}" target="_blank" rel="noreferrer">EST源站 ${e}</a>
        <a href="https://fund.eastmoney.com/Fund_sgzt_bzdm.html" target="_blank" rel="noreferrer">限购源：天天基金</a>
      </div>
    </section>

    <section class="toolbar" aria-label="表格筛选">
      <label class="search-box">
        <input id="query" type="search" value="${i.query}" placeholder="🔎 代码 / 基金名称" />
      </label>
      <div class="segmented" role="group" aria-label="溢价过滤">
        ${[["all","全部"],["discount","折价"],["premium","溢价"],["live","实时"]].map(([n,c])=>`<button class="${i.stance===n?"active":""}" data-stance="${n}" type="button">${c}</button>`).join("")}
      </div>
    </section>

    <section class="board" aria-label="LOF EST 表格">
      <div class="board-topline">
        <div><span class="mono">${t.length}</span><small> 当前显示</small></div>
        <button class="rank-reset" type="button" data-sort-key="rank">源站顺序 ${g("rank")}</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${y.map(N).join("")}</tr>
          </thead>
          <tbody>${t.map(C).join("")}</tbody>
        </table>
      </div>
    </section>
  `),D()}function o(t,e,r=""){return`
    <article class="detail-metric ${r}">
      <span>${t}</span>
      <strong>${u(e)}</strong>
    </article>
  `}function I(t){const e=String(t??"");if(!e.includes("%"))return"";const r=h(e);return r==null?"":r<0?"est-red":r>0?"est-green":""}function q(t){return`
    <section class="detail-section">
      <div class="section-title">
        <h2>${t.title}</h2>
        <span>${t.rows.length} 行</span>
      </div>
      <div class="mini-table-wrap">
        <table class="mini-table">
          <thead>
            <tr>${t.headers.map(e=>`<th>${u(e).replace("EST","<strong>EST</strong>")}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${t.rows.map(e=>`
                  <tr>
                    ${e.map(r=>`<td class="${I(r)}">${u(r)}</td>`).join("")}
                  </tr>
                `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `}function F(t){var a,n,c;const e=i.rows.find(d=>d.code===t);if(!e){m.innerHTML=p(`
      <section class="error">没有找到 ${t} 的本地详情数据。</section>
    `);return}const r=e.detail,s=(r==null?void 0:r.tables)||[];m.innerHTML=p(`
    <nav class="detail-nav">
      <a href="#/">← 返回列表</a>
      <a href="${(r==null?void 0:r.sourceUrl)||e.href}" target="_blank" rel="noreferrer">目标站详情 ↗</a>
    </nav>

    <section class="detail-hero">
      <div>
        <p class="detail-kicker">📈 ${e.code}</p>
        <h2>${e.name}</h2>
        <p>${(r==null?void 0:r.title)||`${e.name}【${e.code}】`}</p>
      </div>
      <div class="detail-metrics">
        ${o("现价",e.price,l(e,"price"))}
        ${o("涨幅",e.change,l(e,"change"))}
        ${o("官方溢价",e.officialPremium,l(e,"officialPremium"))}
        ${o("实时溢价",e.realtimePremium,l(e,"realtimePremium"))}
      </div>
    </section>

    <section class="detail-grid">
      ${o("官方EST",e.officialEst)}
      ${o("参考EST",e.referenceEst)}
      ${o("实时EST",e.realtimeEst)}
      ${o("申购状态",(a=e.purchaseLimit)==null?void 0:a.status)}
      ${o("日累计限额",(n=e.purchaseLimit)==null?void 0:n.dailyLimit)}
      ${o("账户口径",((c=e.purchaseLimit)==null?void 0:c.accountScope)||"平台规则")}
      ${o("EST日期",e.estDate)}
      ${o("行情日期",e.quoteDate)}
      ${o("行情时间",e.quoteTime)}
    </section>

    ${s.length?s.map(q).join(""):'<section class="error">详情表格抓取为空。</section>'}
  `,`${e.name}`)}function w(t){i.sortKey===t?i.sortDirection=i.sortDirection==="asc"?"desc":"asc":(i.sortKey=t,i.sortDirection="asc"),b()}function D(){var t;(t=document.querySelector("#query"))==null||t.addEventListener("input",e=>{var r;i.query=e.target.value,f(),(r=document.querySelector("#query"))==null||r.focus()}),document.querySelectorAll("[data-stance]").forEach(e=>{e.addEventListener("click",()=>{i.stance=e.dataset.stance,f()})}),document.querySelectorAll("[data-sort-key]").forEach(e=>{e.addEventListener("click",()=>w(e.dataset.sortKey))})}function b(){const t=T();t.page==="detail"?F(t.code):f()}async function O(){const t=await fetch("/data/lof.json");if(!t.ok)throw new Error("LOF data failed to load");const e=await t.json();i.meta=e,i.rows=e.rows,b()}window.addEventListener("hashchange",b);O().catch(t=>{m.innerHTML=`<main class="shell"><section class="error">${t.message}</section></main>`});

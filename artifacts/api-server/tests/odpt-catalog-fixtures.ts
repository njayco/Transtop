// Reviewed CC BY 4.0 catalog description excerpts, credited via their dataset links.
const credits='<p>※本コンテンツ等は <a href="https://creativecommons.org/licenses/by/4.0/deed.ja">CC BY 4.0</a> の下でライセンスされています。クレジット表示については、<a href="https://developer.odpt.org/ja/faq-info#cc-by-credit">こちらのFAQ</a> をご参照ください。 / This content, etc. is licensed under <a href="https://creativecommons.org/licenses/by/4.0/deed.ja">CC BY 4.0</a> .Please refer to <a href="https://developer.odpt.org/en/faq-info#cc-by-credit">this FAQ</a> for crediting this content, etc.</p>';
export const catalogNotes:Record<string,string>={
  "odpt-sendai":`<p>仙台市交通局のGTFS-JPデータ及びGTFSリアルタイムデータです。
※運用の関係で、GTFS-JP内に一部類似データがございます。
このため、リアルタイムデータとの連携に一部不具合が生じる場合がございますのでご注意ください。 / GTFS-JP and GTFS-Realtime data of Transportation Bureau, City of Sendai.
※Certain GTFS-JP data entries may be similar due to operational reasons, which may result in issues with Realtime data integration.  </p>`,
  "odpt-sendai-realtime":"<p>【リアルタイム情報】仙台市交通局のGTFSリアルタイムデータです。 / [realtime information] GTFS Realtime data of Transportation Bureau, City of Sendai.  </p>",
  "odpt-hana":"<p>西東京市コミュニティバス「はなバス」のGTFS-JPデータです。（第１ルート、第２ルート、第３ルート、第４北ルート、第４南ルート）  </p>",
  "odpt-tosaden":`<p>とさでん交通、路面電車のGTFS Scheduleデータです / This is the GTFS schedule data for Tosaden Traffic Streetcars.
固定URL / Permanent URL
■現行 / Current　<a href="https://api-public.odpt.org/api/v4/files/odpt/TosadenTraffic/Streetcar.zip?date=current" target="_blank" rel="nofollow">https://api-public.odpt.org/api/v4/files/odpt/TosadenTraffic/Streetcar.zip?date=current</a>
■次代 / Next　<a href="https://api-public.odpt.org/api/v4/files/odpt/TosadenTraffic/Streetcar.zip?date=next" target="_blank" rel="nofollow">https://api-public.odpt.org/api/v4/files/odpt/TosadenTraffic/Streetcar.zip?date=next</a>  </p>`,
};
export function catalogHtml(id:string,slug:string){
  return `<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a><div class="notes embedded-content">${catalogNotes[id]}\n${credits}</div><a href="/dataset/${slug}/resource/00000000-0000-0000-0000-000000000000">Resource</a>`;
}

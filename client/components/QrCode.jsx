import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** 参加用QRコード。外部サービスへは送信せず、ブラウザ内で生成する */
export default function QrCode({ url }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      color: { dark: '#141433', light: '#f5edd8' },
    })
      .then((dataUrl) => alive && setSrc(dataUrl))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);

  if (!src) return <div className="qr qr-loading">QR生成中…</div>;
  return <img className="qr" src={src} alt="参加用QRコード" width="240" height="240" />;
}

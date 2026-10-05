# img2string

**Turn a picture into string art you can wind by hand.**<br>
**把圖片變成可以親手繞出來的釘線畫。**

[English](#english) · [繁體中文](#繁體中文)

---

## English

img2string works out how to wind thread around pins on a circular frame so that,
from a normal viewing distance, the threads reproduce a picture: one continuous
thread for a black-and-white piece, or one continuous thread per colour. It
runs in your browser, and your pictures are not uploaded.

This is the first milestone: the core that scores and chooses lines, with the
checks it must pass. The page itself arrives with the next one.

### Run it locally

Node.js 24 or newer:

```
npm ci
npm test          # the core's checks and both benchmarks
npm run bench     # the benchmark table
npm run dev       # the page (a placeholder for now)
```

### More

- [DECISIONS.md](DECISIONS.md) (in Chinese): every detail the specification
  leaves open, with the measurements behind each choice.

### License

[GNU General Public License v3.0 or later](LICENSE).

---

## 繁體中文

img2string 會算出線要怎麼繞在圓框的釘子上，讓人從正常的觀看距離看過去時，線條重現一張圖：黑白作品用一條不間斷的線，彩色作品每個顏色一條。它在你的瀏覽器裡執行，圖片不會上傳。

這是第一個里程碑：替線條評分、選線的核心，以及它必須通過的檢查。網頁本身在下一個里程碑加入。

### 本機執行

需要 Node.js 24 以上：

```
npm ci
npm test          # 核心的檢查與兩個基準
npm run bench     # 基準成績表
npm run dev       # 網頁（目前只有外殼）
```

### 更多說明

- [DECISIONS.md](DECISIONS.md)：規格沒有定義的每個細節，以及每個選擇背後的實測數字。

### 授權

[GNU General Public License v3.0 或更新版本](LICENSE)。

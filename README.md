# img2string

**Turn a picture into string art you can wind by hand.**<br>
**把圖片變成可以親手繞出來的釘線畫。**

**Use it online: <https://far9100.github.io/img2string/>** (nothing to download or install)<br>
**線上使用：<https://far9100.github.io/img2string/>**（不需要下載或安裝）

[English](#english) · [繁體中文](#繁體中文)

---

## English

img2string works out how to wind thread around pins on a frame, round or
rectangular, so that,
from a normal viewing distance, the threads reproduce a picture: one continuous
thread for a black-and-white piece, or one continuous thread per colour. It
shows what the finished piece will look like and makes everything needed to
build it by hand: a nail template printed at full size, the winding sequence, a
step-by-step player and the thread lengths. It runs in your browser, and your
pictures are not uploaded.

```
Thread 1 of 1 · Black (#111111)
Start: pin 61 (2:50) · End: pin 139 (6:30) · Lines: 1450 · Thread: 629 m

[ ]    1    61 199  59 197  60 250 100  20 122  15   2:50
[ ]   11    94  17 119  12  90  14 123  11  83   8   4:20
[ ]   21    81 178  83   7 109  21  99 255  69 206   3:45
```

*The start of the winding instructions for the built-in face sample: 256 pins
on a 500 mm frame, one black thread.*

### Use it

Open **<https://far9100.github.io/img2string/>** in your browser, on a computer
or a phone. There is nothing to download or install.

1. **Upload picture** (or drop it on the page, or paste it), or try a sample.
   Drag the picture to place it inside the pin ring; scroll or pinch to zoom.
2. Choose the colours: **One colour** or **Several colours**, a palette, the
   board colour and the winding order. Choose the frame: round, or a
   rectangle with the picture's proportions. Set its size, the number of pins
   (64 to 512) and the thread width. For a line drawing, add pins inside the
   picture (see below).
3. Optionally, **Find the settings closest to the picture** sets the
   adjustment sliders for you.
4. **Generate**. Lines appear while it works; **Stop** keeps what is there,
   and **Continue** carries on from it.
5. Look at the result at **True thread width**, from a **Viewing distance**,
   side by side with the picture, or through the **Magnifier**.
6. **Download nail template (PDF)**, print it at 100 % and check its 100 mm
   bar with a ruler. Tape the pages together, nail through the marks.
7. **Start winding**: the player shows the next pin in large numerals. Space,
   Enter or the right arrow moves on; the left arrow goes back. It remembers
   where you stopped.

### How it works

Pins are spaced evenly around a frame and a thread is stretched from pin to pin
thousands of times. Up close it is a web of straight lines; from a distance the
eye averages the density of the lines into tones. Petros Vrellis made this
widely known with *A New Way to Knit* (2016), and Birsak, Rist, Wonka and
Musialski gave the most complete treatment in *String Art: Towards
Computational Fabrication of String Images* (2018).

img2string treats every thread colour as an opaque layer that covers part of
each pixel, with the layers stacked in winding order. That gives the exact
change of the error for any candidate line, cheaply, so the generator can try
every line from the current pin and take the best one, again and again. Every
thread always continues from the pin it is on, so each colour is one continuous
thread by construction.

Three facts explain what comes out:

- **Lines crowd near the rim.** If every pair of pins were used equally, the
  density of lines at radius r would follow the complete elliptic integral
  K(r): at 90 % of the radius it is 1.45 times the density near the centre, at
  95 % it is 1.65 times. Backgrounds near the rim therefore look busy; dark
  backgrounds, tight crops and the **Quiet rim** preset work better.
- **A line cannot be placed finely near the centre.** Moving one end of a line
  to the next pin shifts the line by about half the pin spacing. With 256 pins
  on a 500 mm frame the pins are 6.1 mm apart, so a line near the centre lands
  to about 3 mm. Fine features are formed by many lines crossing from
  different directions.
- **Colours mix like dots, not like inks.** Opaque threads lie side by side
  and the eye averages their colours. Only colours between the board colour
  and the thread colours can be reached: cyan, magenta and yellow threads
  cannot make a saturated red, green or blue the way inks do. If the picture
  needs a colour, wind a thread close to it.

### Good pictures, and limits

- Pictures that are fairly dark and smooth, without large very light areas,
  come out best. Very light areas will look grey, because every line crosses
  the whole circle.
- With one black thread, dark details reach about mid-grey, not black: on the
  built-in face the eyes and hair come out at about 40 % of the picture's
  contrast. The palette **Black, then white, on a white board** winds a white
  thread last, which covers the black where the picture is light; it nearly
  doubles the contrast, at about three times the lines and the winding time.
- With several colours the winding order matters a great deal. **Find the best
  order** tries every order (up to four threads) and takes about ten seconds.
- **Line drawings are the hardest pictures.** Thin outlines on white are
  mostly bare board, and a line that draws an outline also crosses the empty
  parts and greys them. At the settings a picture starts with, the 81 test
  drawings got 60 to 490 lines (median 212) and no recognisable picture. The
  automatic adjustment (below) helps, and a white thread wound last helps
  more, at about five times the lines; the page says so when a picture is
  mostly blank. More pins on the frame do not rescue a line drawing: going
  from 128 to 256 pins matters, beyond 256 it adds little. Pins inside the
  picture do (below).
- A piece is hours of work: at 8 seconds per line, 1,450 lines take a little
  over 3 hours.

### Tools for a better piece

- **Find the settings closest to the picture** sets the sliders under *Adjust
  the picture* and the two emphases below by trying them: about forty
  settings, each generated, drawn at true thread width and compared with the
  picture as it was before any adjustment. It keeps the closest and tells
  how close. On the face sample the similarity rises from 41 % to 50 %; on
  twelve test line drawings from 42 % to 56 % (median), and with a white
  thread wound last to 72 %. It takes ten seconds to a minute, and changes
  nothing but those sliders.
- **A rectangular frame** shows the whole picture. Hardly any picture is
  round: a circle shows 59 % of a 4:3 picture at most, and the page says so
  when a picture is not square, with **Use a rectangular frame** beside it.
  The rectangle always has the picture's proportions; you set its longer
  side. Pin 1 is next to the top left corner and the numbers run clockwise.
  On eight line drawings the round piece, laid back on the whole picture, is
  44 % like it; the rectangular one 52 %. The shape of the frame does not
  make a piece better where both show the picture: a line still crosses all
  of it (DECISIONS D-57). What does is pins inside the picture: the next
  point.
- **Pins inside the picture** (under *Frame and thread*) put up to 600 more
  pins on the picture's own strokes, so that a line can run along a stroke
  instead of crossing the whole frame. On eight line drawings with 300 of
  them the similarity rises from 56 % to 68 % (every one of the eight), and
  with a white thread as well from 73 % to 83 %; the face sample goes from
  50 % to 68 %. The page offers them when a picture is mostly blank. What
  they cost: a few hundred more nails, whose heads show in the picture (the
  preview draws them); about twice the lines, though less thread; and a
  board that fits this one picture, because the pins stand where its strokes
  are. Nothing that leaves the picture as it is moves them: generating again
  keeps every pin where it was. When no line from where the thread is helps
  any more, the thread goes on somewhere else: round the outside of the
  frame, or back along a line it has wound. The instructions mark a step
  round the frame with “~”, the template numbers every pin, and the player
  shows the next pin among its neighbours. The thread that goes round the
  frame lies along its nails, outside the picture: about a hundred times in
  a piece, which no preview shows (DECISIONS D-60).
- **Centre first** and **Centre only** (under *What matters most*) let the
  outer part of the frame go for the sake of its middle. With Centre only
  the outer third does not count at all and comes out as a tangle; on the
  same drawings the middle rises from 56.5 % to 63.5 % like the picture, with
  a third fewer lines. Centre first keeps a faint outer part: 61.5 %. The
  brush can make any place count again.
- **Can these threads make the picture's colours?** With several colours, the
  page hatches the parts of the picture whose colour the board and the threads
  cannot mix, names the colour that is missing most and offers to add a thread
  of it. On the colour-wheel sample with cyan, magenta, yellow and black,
  about 60 % of the picture is out of reach; one green thread brings that
  down to a third.
- **Let the picture choose the threads** picks up to six threads for the
  picture, from any colour or from your own list of thread colours.
- **Emphasise outlines** and **Emphasise dark detail** take importance from
  the picture itself. The second trades evenness for contrast: at full
  strength the face sample's contrast rises from about 40 % to about 60 % of
  the picture's, while light areas turn greyer and 45 % more thread is used.
  Both are off unless you turn them on.
- **Kind of thread** sets a typical width; **Measure it from a photo** works
  the width out from a photograph of parallel threads next to bare board.
- **Allow the same pin pair again** lets lines stack up to three times where
  the picture is very dark. It rarely changes much.
- In the player, **Read the pin numbers aloud** uses a voice installed on
  your device, never an online one. Where the device has none, the option is
  not offered.

### What the numbers say

- **Error removed (model)**: how much of the difference between the bare board
  and the picture the lines remove, in the quick model that guides the
  generator.
- **Error removed (true width)**: the same, measured on a render with every
  line at its true width. It is a few points lower, and the more honest one.
- **Mean colour difference ΔE ×100**: the average difference from the picture
  inside the pin ring, in the OKLab colour space; before and after.
- **Similarity to the picture**: how much the piece at true thread width
  looks like the picture as it was before any adjustment, from 0 % (the bare
  board) to 100 % (the picture itself). The other three numbers compare with
  the adjusted target, point by point; this one compares structure at six
  scales, from thread texture to the overall tone, and is what the automatic
  adjustment raises. Use it to compare settings on one picture, not one
  picture with another: detail finer than about 5 mm scores low in every
  string piece.

### Saving

**Save project** writes a `.img2string.json` file with the settings and the
winding sequence. The picture is recorded by name and fingerprint only, unless
you choose to keep it inside the file. Opening a project shows exactly the
piece that was saved, including where you had got to in the player.

Other downloads: the template as SVG or DXF (for a laser or a CNC drill), the
sequence as CSV or text, the preview as PNG, and the lines as SVG.

### Run it locally

Only needed to work on the code. Node.js 24 or newer:

```
npm ci
npm run dev             # the page, at the address it prints
npm test                # unit and acceptance tests, with both benchmarks
npm run test:slow       # the winding-order search against all 24 orders (2 min)
npm run e2e             # end-to-end tests in the installed Microsoft Edge
npm run bench           # the benchmark table
npm run bench:browser   # the same benchmarks in the browser's worker
npm run build           # the static site, in dist/
```

Every push to `main` is tested, built and published to the address above
([.github/workflows/pages.yml](.github/workflows/pages.yml)).

### More

- [DECISIONS.md](DECISIONS.md) (in Chinese): every detail the specification
  leaves open, with the measurements behind each choice.
- [docs/manual-checks.md](docs/manual-checks.md) (in Chinese): the checks that
  need a printer, a ruler, nails and thread.

### License

[GNU General Public License v3.0 or later](LICENSE). Third-party code and the
font: [docs/third_party.md](docs/third_party.md).

---

## 繁體中文

img2string 會算出線要怎麼繞在框上的釘子之間（圓框或長方框），讓人從正常的觀看距離看過去時，線條重現一張圖：黑白作品用一條不間斷的線，彩色作品每個顏色一條。它會顯示成品的樣子，並做出手作需要的一切：原寸列印的釘位模板、繞線順序、逐步播放器，以及線長。它在你的瀏覽器裡執行，圖片不會上傳。

```
第 1 / 1 條線 · 黑 (#111111)
起點：61 號釘（2:50）· 終點：139 號釘（6:30）· 線數：1450 條 · 線長：629 m

[ ]    1    61 199  59 197  60 250 100  20 122  15   2:50
[ ]   11    94  17 119  12  90  14 123  11  83   8   4:20
[ ]   21    81 178  83   7 109  21  99 255  69 206   3:45
```

*內建臉部範例的繞線說明開頭：500 mm 圓框、256 根釘、一條黑線。*

### 使用方式

用瀏覽器打開 **<https://far9100.github.io/img2string/>** 就能用，電腦或手機都可以，不需要下載或安裝。

1. 按〔上傳圖片〕（也可以把圖拖進頁面或直接貼上），或先試內建範例。拖曳圖片把它擺進釘環，滾輪或雙指可以縮放。
2. 選顏色：〔單色〕或〔多色〕、調色盤、板子顏色與繞線順序。選框形：圓形，或長寬比跟著圖片的長方形。設定框的大小、釘數（64 到 512）與線寬。線稿可以再加〔畫面內的釘子〕（見下文）。
3. 需要的話，按〔找出最接近原圖的數值〕，讓程式替你設定調整圖片的滑桿。
4. 按〔生成〕。計算時線條會逐步出現；按〔停止〕會保留目前的結果，按〔繼續〕可以接著算。
5. 用〔真實線寬〕、〔觀看距離〕、和圖片並排，或用〔放大鏡〕檢查結果。
6. 按〔下載釘位模板（PDF）〕，以 100% 列印，用尺量一下上面的 100 mm 比例尺。把各頁貼在一起，照記號釘上釘子。
7. 按〔開始繞線〕：播放器用大字顯示下一個釘號。空白鍵、Enter 或右鍵前進，左鍵後退，它會記住你繞到哪裡。

### 原理

釘子等距排在框上，一條線在釘子之間來回拉幾千次。近看是一張直線織成的網；拉開距離後，眼睛會把線的疏密平均成明暗。Petros Vrellis 的 *A New Way to Knit*（2016）讓這種做法廣為人知；Birsak、Rist、Wonka 與 Musialski 的 *String Art: Towards Computational Fabrication of String Images*（2018）是最完整的研究。

img2string 把每個線色看成一層不透明、只蓋住每個像素一部分的圖層，各層依繞線順序疊起來。這樣就能便宜而精確地算出任何一條候選線會讓誤差改變多少，生成器於是可以從目前的釘子試過每一條線、選最好的那條，一再重複。每條線都從它所在的釘子接著走，所以每個顏色必然是一條不間斷的線。

三件事決定了成品的樣子：

- **線在邊緣比較密。** 如果每一對釘子都用得一樣多，半徑 r 處的線密度會跟著第一類完全橢圓積分 K(r) 變化：在 90% 半徑處是中心附近的 1.45 倍，95% 處是 1.65 倍。所以靠近邊緣的背景容易顯得雜亂；深色背景、裁緊一點，或用〔邊緣放輕〕效果比較好。
- **靠近中心的線放不準。** 把線的一端換到隔壁的釘子，線大約平移半個釘距。500 mm 圓框上 256 根釘的釘距是 6.1 mm，所以中心附近的線只能準到 3 mm 左右。細節是靠很多條線從不同方向交會出來的。
- **顏色是並排混色，不是疊印。** 不透明的線並排著，眼睛把它們的顏色平均。能做出的顏色只在板色與各線色「之間」：青、洋紅、黃三種線做不出像油墨那樣飽和的紅、綠、藍。圖片需要某個顏色，就加一條接近它的線。

### 適合的圖與限制

- 偏暗、平順、沒有大片很亮區域的圖效果最好。很亮的地方會偏灰，因為每條線都橫越整個圓。
- 只用一條黑線時，深色細節只能暗到中灰，到不了黑：內建的臉部範例裡，眼睛與頭髮的對比大約只有原圖的四成。調色盤〔白板，先黑線再白線〕會在最後繞一條白線，在圖片亮的地方把黑線蓋掉，對比幾乎加倍，但線數與繞線時間約為三倍。
- 用好幾個顏色時，繞線順序影響很大。〔找出最佳順序〕會試過所有順序（最多四條線），大約十秒。
- **線稿是最難的圖。** 白底細線的圖大部分是空白的板子，而畫輪廓的線同時也橫越空白處、把它弄灰。以圖片一開始的設定，81 張測試線稿只繞出 60 到 490 條線（中位數 212），看不出原圖。下面的自動調整有幫助，再加一條最後繞的白線幫助更大，代價是線數約五倍；圖片大部分是空白時，頁面會直接說明。在框上多釘釘子救不了線稿：128 釘到 256 釘差很多，256 釘以上就差不多了。把釘子釘進畫面裡才有用（見下文）。
- 一件作品要花好幾個小時：以每條線 8 秒計，1,450 條線要三個小時多一點。

### 讓成品更好的工具

- **找出最接近原圖的數值**：〔調整圖片〕的滑桿和下面兩個「強調」不必自己試。程式會試大約四十組數值，每一組都實際算出繞線結果、以真實線寬畫出來，和「還沒做任何調整的原圖」比較，留下最像的一組，並告訴你有多像。臉部範例的相似度從 41% 升到 50%；十二張測試線稿從 42% 升到 56%（中位數），再加一條最後繞的白線則到 72%。需要十幾秒到一分鐘，而且只會動那些滑桿。
- **長方框**看得到整張圖。幾乎沒有圖片是圓的：4:3 的圖放進圓框，最多只看得到 59%；圖片不是正方形時，頁面會說出這個數字，旁邊就是〔改用長方框〕。長方框的長寬比永遠跟著圖片，你只設定長邊。1 號釘在左上角旁邊，順時針編號。8 張測試線稿上，把圓框的成品放回整張圖上比，相似度是 44%，長方框是 52%。在兩種框都看得到的地方，框的形狀不會讓成品更像，因為每條線還是橫越整個畫面（DECISIONS D-57）；會讓它更像的是釘在畫面裡面的釘子，見下一點。
- **畫面內的釘子**（在〔框與線〕裡）：再把最多 600 根釘子放在圖片自己的筆畫上，線就可以沿著筆畫走，不必每一條都橫越整個框。8 張測試線稿加 300 根時，相似度從 56% 升到 68%（8 張全部提高）；再加一條白線，是從 73% 升到 83%；臉部範例從 50% 升到 68%。圖片大部分是空白時，頁面會主動提供這個選項。代價：多幾百根釘子，釘頭會出現在畫面裡（預覽會畫出來）；線大約多一倍，不過線長比較短；而且板子只能做這一張圖，因為釘子跟著它的筆畫。只要圖片沒動，釘子就不會動：重新生成時每一根都留在原位。線所在的釘子已經沒有任何有益的線時，線會移到別處繼續：沿著框的外側繞過去，或沿著繞過的線走回去。繞線說明在沿框繞的那一步前面印「~」，模板替每一根釘子標上號碼，播放器會把下一根釘和它周圍的釘子一起畫出來。沿框繞的線會貼在框上釘子的外側、畫面之外，每件大約一百次，預覽圖畫不出這一圈（DECISIONS D-60）。
- **中央優先**與**只管中央**（在〔哪裡比較重要〕裡）為了中央而放掉框的外圈。〔只管中央〕完全不管外面三分之一，那裡會是亂的；同樣那些線稿，中央和原圖的相似度從 56.5% 升到 63.5%，線還少了三分之一。〔中央優先〕留下淡淡的外圈：61.5%。筆刷可以把任何地方塗回重要。
- **這些線混得出圖片的顏色嗎**：多色時，頁面會在圖片上用斜線標出板子和線混不出來的地方，說出最缺的是哪個顏色，並可以直接加一條那個顏色的線。色環範例配青、洋紅、黃、黑時，約有 60% 的面積混不出來；加一條綠線就降到三分之一。
- **讓圖片決定線色**：依圖片選出最多六條線，可以從任何顏色裡選，也可以只從你自己的線色清單裡選。
- **強調輪廓**與**強調深色細節**：由圖片本身決定哪裡比較重要。後者是拿均勻換對比：開到最強時，臉部範例的對比從原圖的四成左右升到六成左右，但淺色的地方會偏灰，線也多用四成五。兩者預設都是關的。
- **線的種類**帶入常見的線寬；**用照片量線寬**則從一張「平行的線加上旁邊空白板子」的照片算出線寬。
- **同一對釘子可以重複繞**：圖片很深的地方最多可以疊三次。通常差別不大。
- 播放器的**唸出釘號**只用裝在你這台裝置上的語音，不用線上語音；裝置沒有合適的語音時，不提供這個選項。

### 數字的意思

- **誤差降低（模型）**：線條消除了「空白板子」與圖片之間多少的差距，以引導生成器的快速模型計算。
- **誤差降低（真實線寬）**：同一件事，但在每條線都以真實寬度畫出的渲染上量。它會低幾個百分點，也比較誠實。
- **平均色差 ΔE ×100**：釘環以內與圖片的平均差異，在 OKLab 色彩空間裡量；前後各一個數字。
- **和原圖的相似度**：以真實線寬畫出來的成品，有多像「還沒做任何調整的原圖」，從 0%（空白的板子）到 100%（原圖自己）。前三個數字是和調整後的目標圖逐點比較；這一個比的是六個尺度上的結構，從線的紋理到整體的明暗，也是自動調整要提高的數字。它適合比較同一張圖的不同設定，不適合拿兩張圖互比：5 mm 以下的細節，任何釘線畫的分數都低。

### 存檔

〔儲存專案〕會寫出一個 `.img2string.json` 檔，內含設定與繞線順序。圖片只記檔名與指紋，除非你選擇把圖片存進檔案。開啟專案會看到和存檔時完全相同的作品，包括播放器繞到哪一步。

其他下載：模板的 SVG 或 DXF（給雷射或 CNC 鑽孔用）、繞線順序的 CSV 或文字檔、預覽圖 PNG，以及線條的 SVG。

### 本機執行

只有要改程式時才需要。需要 Node.js 24 以上：

```
npm ci
npm run dev             # 網頁，網址會印在終端機
npm test                # 單元與驗收測試，含兩個基準
npm run test:slow       # 自動順序對照全部 24 種順序（約 2 分鐘）
npm run e2e             # 端對端測試，使用電腦上的 Microsoft Edge
npm run bench           # 基準成績表
npm run bench:browser   # 在瀏覽器的 worker 裡跑同樣的基準
npm run build           # 靜態網站，輸出到 dist/
```

每次推送到 `main`，都會自動測試、建置並發佈到上面的網址（[.github/workflows/pages.yml](.github/workflows/pages.yml)）。

### 更多說明

- [DECISIONS.md](DECISIONS.md)：規格沒有定義的每個細節，以及每個選擇背後的實測數字。
- [docs/manual-checks.md](docs/manual-checks.md)：需要印表機、尺、釘子和線的檢查。

### 授權

[GNU General Public License v3.0 或更新版本](LICENSE)。第三方程式碼與字型：[docs/third_party.md](docs/third_party.md)。

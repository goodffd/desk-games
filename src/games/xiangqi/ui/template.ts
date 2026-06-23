export const XIANGQI_HTML = `
      <section class="stage">
        <header class="masthead">
          <div class="title-wrap">
            <h1>象棋</h1>
            <span class="subtitle">XIANGQI</span>
          </div>
          <div id="status" class="seal turn-red">
            <span class="seal-chop">帅</span>
            <span class="turn-text">红方先行</span>
          </div>
        </header>
        <div class="clocks" id="clocks" hidden>
          <span class="clock" id="clock-red"><b>红</b><span class="t">10:00</span></span>
          <span class="clock" id="clock-black"><b>黑</b><span class="t">10:00</span></span>
        </div>
        <div class="book-line" id="book-line" hidden>
          <span class="book-badge" id="book-badge">开局</span>
          <span class="book-moves" id="book-moves"></span>
        </div>
        <div class="board-wrap">
          <canvas id="board" width="540" height="600"></canvas>
        </div>
        <div class="controls">
          <!-- 对战：可收拢，默认展开（主入口） -->
          <div class="ctrl-fold open">
            <button class="fold-head" type="button"><span class="fold-arrow">▸</span><span class="fold-title">对战</span></button>
            <div class="fold-body">
              <span class="mode-hint">点击切换 双人 / 人机 模式</span>
              <button id="mode" class="btn btn-primary">双人</button>
              <div class="level-field" id="level-field" hidden>
                <label for="level">棋力</label>
                <select id="level" class="select">
                  <option value="beginner">入门</option>
                  <option value="easy" selected>初级</option>
                  <option value="medium">中级</option>
                </select>
              </div>
              <button id="online" class="btn">联机</button>
            </div>
          </div>
          <!-- 本局：平铺，仅对局中显示 -->
          <div class="ctrl-group" id="grp-game" hidden>
            <span class="ctrl-label">本局</span>
            <button id="undo" class="btn">悔棋</button>
            <button id="restart" class="btn">重新开局</button>
            <button id="export-pgn" class="btn">导出棋谱</button>
          </div>
          <!-- 棋库：可收拢，默认收起 -->
          <div class="ctrl-fold">
            <button class="fold-head" type="button"><span class="fold-arrow">▸</span><span class="fold-title">棋库</span></button>
            <div class="fold-body">
              <button id="browse" class="btn">开局库</button>
              <button id="endgame" class="btn">残局库</button>
              <button id="reset-eg" class="btn" hidden>重摆残局</button>
            </div>
          </div>
          <!-- 设置：可收拢，默认收起 -->
          <div class="ctrl-fold">
            <button class="fold-head" type="button"><span class="fold-arrow">▸</span><span class="fold-title">设置</span></button>
            <div class="fold-body">
              <div class="level-field" id="theme-field">
                <label for="theme">主题</label>
                <select id="theme" class="select">
                  <option value="cinnabar">朱砂水墨</option>
                  <option value="wood">原木棋枰</option>
                  <option value="night">夜间墨玉</option>
                  <option value="plain">素雅纸枰</option>
                </select>
              </div>
              <div class="level-field" id="clock-field">
                <label for="clock-mode">计时</label>
                <select id="clock-mode" class="select">
                  <option value="off" selected>不计时</option>
                  <option value="banker">包干</option>
                  <option value="byoyomi">读秒</option>
                </select>
              </div>
              <div class="level-field" id="clock-params" hidden>
                <input id="clock-main-min" class="num" type="number" min="1" max="180" value="10" title="基本时间(分钟)" />
                <span class="num-unit">分</span>
                <input id="clock-byo-sec" class="num" type="number" min="5" max="300" value="30" title="读秒每步(秒)" />
                <span class="num-unit" id="clock-byo-unit">秒读秒</span>
              </div>
              <button id="mute" class="btn">🔊 音效</button>
              <button id="book-hint" class="btn">📖 开局提示</button>
              <button id="import-pgn" class="btn">📂 导入棋谱</button>
              <input id="import-file" type="file" accept=".pgn,text/plain" hidden />
            </div>
          </div>
        </div>
        <div class="browse-panel" id="browse-panel" hidden>
          <div class="level-field">
            <label for="open-sel">开局</label>
            <select id="open-sel" class="select"></select>
          </div>
          <div class="browse-step">
            <button id="b-prev" class="btn">上一步</button>
            <button id="b-next" class="btn btn-primary">下一步</button>
            <div class="level-field" id="var-field" hidden>
              <label for="var-sel">变着</label>
              <select id="var-sel" class="select"></select>
            </div>
            <button id="b-exit" class="btn">退出</button>
          </div>
          <div class="book-moves-list" id="b-moves"></div>
        </div>
        <div class="endgame-panel" id="endgame-panel" hidden>
          <div class="level-field">
            <label for="eg-sel">残局</label>
            <select id="eg-sel" class="select"></select>
            <span class="eg-goal" id="eg-goal"></span>
          </div>
          <div class="browse-step">
            <button id="eg-play" class="btn btn-primary">打这盘</button>
            <button id="eg-solve" class="btn">看解法</button>
            <button id="eg-prev" class="btn" hidden>上一步</button>
            <button id="eg-next" class="btn" hidden>下一步</button>
            <button id="eg-exit" class="btn">退出</button>
          </div>
          <div class="book-moves-list" id="eg-moves" hidden></div>
        </div>
        <div class="online-panel" id="online-panel" hidden>
          <!-- 仅本地文件打开时 -->
          <div class="o-view" id="o-unavailable" hidden>联机需通过服务器网址访问（当前是本地文件，仅能本地对弈）。</div>
          <!-- ① 输名字关 -->
          <div class="o-view" id="o-gate" hidden>
            <div class="o-gate-row">
              <label for="o-nick-input">你的昵称</label>
              <input id="o-nick-input" class="num" maxlength="12" placeholder="输入昵称" style="width:150px" />
              <button id="o-enter" class="btn btn-primary">进入大厅</button>
            </div>
            <div class="o-msg" id="o-gate-msg"></div>
          </div>
          <!-- ② 大厅 -->
          <div class="o-view" id="o-lobby" hidden>
            <div class="o-bar">
              <span class="o-me">我：<b id="o-me-nick"></b></span>
              <button id="o-rename" class="btn btn-mini">✎ 改名</button>
              <span class="o-bar-spacer"></span>
              <button id="o-exit" class="btn btn-mini">退出联机</button>
            </div>
            <div class="o-create-row">
              <button id="o-create" class="btn btn-primary">＋ 创建房间</button>
              <label class="o-private"><input type="checkbox" id="o-private" /> 私密房（不进大厅，仅凭房间码加入）</label>
            </div>
            <div class="o-list-head">房间列表</div>
            <div class="o-room-list" id="o-room-list"></div>
            <details class="o-bycode">
              <summary>有房间码？点此输码加入</summary>
              <div class="o-bycode-row">
                <input id="o-code-input" class="num" maxlength="6" placeholder="房间码" style="width:120px" />
                <button id="o-code-submit" class="btn">加入</button>
              </div>
            </details>
            <div class="o-msg" id="o-lobby-msg"></div>
          </div>
          <!-- ③ 我的房间·等待对手 -->
          <div class="o-view" id="o-waiting" hidden>
            <div class="o-wait-title" id="o-wait-title">房间已创建，等待对手加入…</div>
            <div class="o-wait-code" id="o-wait-code" hidden>房间码 <b id="o-wait-code-val"></b> <button id="o-wait-copy" class="btn btn-mini">复制</button></div>
            <button id="o-cancel" class="btn">取消，返回大厅</button>
          </div>
          <!-- ⑤ 观战 -->
          <div class="o-view" id="o-spectate" hidden>
            <div class="o-spectate-banner" id="o-spectate-banner"></div>
            <button id="o-spectate-exit" class="btn">退出观战</button>
          </div>
        </div>
        <!-- ④ 对局操作（paired 时显示）-->
        <div class="online-actions" id="online-actions" hidden>
          <button id="o-resign" class="btn">认输</button>
          <button id="o-draw" class="btn">求和</button>
          <button id="o-undo" class="btn">请求悔棋</button>
          <span class="o-msg" id="o-game-msg"></span>
          <button id="o-game-exit" class="btn btn-mini">退出</button>
        </div>
        <div class="online-offer" id="online-offer" hidden>
          <span id="o-offer-text"></span>
          <button id="o-accept" class="btn btn-primary">接受</button>
          <button id="o-decline" class="btn">拒绝</button>
        </div>
      </section>
`;

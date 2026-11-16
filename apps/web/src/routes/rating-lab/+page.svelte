<script>
  import { onMount } from "svelte";
  import { API } from "$lib/api.js";
  import RaceIcon from "$lib/components/RaceIcon.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";

  const RACES = ["P", "T", "Z"];
  const RACE_NAMES = { P: "Protoss", T: "Terran", Z: "Zerg" };

  let data = $state(null);
  let loading = $state(true);
  let error = $state("");
  let raceTab = $state("P");

  async function load() {
    loading = true;
    error = "";
    try {
      data = await API.getRatingLab();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function num(value) {
    return value == null ? "—" : Math.round(value);
  }
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:py-8 space-y-6">
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h1 class="text-2xl font-black tracking-tight">评分实验室</h1>
      <Badge variant="outline" class="text-[11px] text-amber-500 border-amber-500/30">只读实验</Badge>
    </div>
    <p class="text-sm text-muted-foreground max-w-3xl">
      这里不参与赛事种子、对阵或现有 MMR。总榜是加权 Bradley-Terry，副榜是按 actual race 拆分的 Glicko；
      Random 不单独成榜，按实际打出的种族计入 P/T/Z。
    </p>
  </div>

  {#if loading}
    <div class="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">正在计算…</div>
  {:else if error}
    <div class="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
      加载失败：{error}
    </div>
  {:else if data}
    <div class="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground">
      <span class="rounded-md border border-border bg-muted/40 px-2 py-1">对局 {data.meta.games_total}</span>
      <span class="rounded-md border border-border bg-muted/40 px-2 py-1">有 actual race {data.meta.games_with_race}</span>
      <span class="rounded-md border border-border bg-muted/40 px-2 py-1">副族降权 {data.meta.weighted_games} 场</span>
      <span class="rounded-md border border-border bg-muted/40 px-2 py-1">最低种族场次 {data.meta.min_race_games}</span>
      {#each Object.entries(data.meta.main_race_overrides) as [id, race]}
        <span class="rounded-md border border-border bg-muted/40 px-2 py-1">{id} 主族 {race}（手动修正）</span>
      {/each}
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <section class="rounded-xl border border-border bg-card overflow-hidden">
        <div class="border-b border-border/60 px-4 py-3">
          <h2 class="text-sm font-bold">加权 Bradley-Terry 总榜</h2>
          <p class="text-[11px] text-muted-foreground mt-0.5">H2H 自然包含；副族打低分降权 0.25</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="text-[11px] text-muted-foreground bg-muted/30">
              <tr>
                <th class="px-3 py-2 text-left font-medium">#</th>
                <th class="px-2 py-2 text-left font-medium">选手</th>
                <th class="px-2 py-2 text-left font-medium">主族</th>
                <th class="px-2 py-2 text-right font-medium">BT</th>
                <th class="px-2 py-2 text-right font-medium">场次</th>
                <th class="px-3 py-2 text-right font-medium">W-L</th>
              </tr>
            </thead>
            <tbody>
              {#each data.overall.slice(0, 15) as p}
                <tr class="border-t border-border/40 hover:bg-muted/20">
                  <td class="px-3 py-2 font-mono text-muted-foreground">{p.rank}</td>
                  <td class="px-2 py-2 font-semibold truncate max-w-40">{p.display_name}</td>
                  <td class="px-2 py-2">
                    <span class="inline-flex items-center gap-1">
                      <RaceIcon race={p.main_race} size={12} />
                      <span class="text-muted-foreground">{p.main_race || "?"}</span>
                    </span>
                  </td>
                  <td class="px-2 py-2 text-right font-mono font-bold text-primary">{num(p.mmr)}</td>
                  <td class="px-2 py-2 text-right font-mono text-muted-foreground">{p.games}</td>
                  <td class="px-3 py-2 text-right font-mono text-muted-foreground">{p.wins}-{p.losses}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-xl border border-border bg-card overflow-hidden">
        <div class="border-b border-border/60 px-4 py-3">
          <h2 class="text-sm font-bold">分族最高 MMR</h2>
          <p class="text-[11px] text-muted-foreground mt-0.5">每个选手取最高种族，至少 {data.meta.min_race_games} 场</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="text-[11px] text-muted-foreground bg-muted/30">
              <tr>
                <th class="px-3 py-2 text-left font-medium">#</th>
                <th class="px-2 py-2 text-left font-medium">选手</th>
                <th class="px-2 py-2 text-left font-medium">最高族</th>
                <th class="px-2 py-2 text-right font-medium">MMR</th>
                <th class="px-2 py-2 text-right font-medium">场次</th>
                <th class="px-3 py-2 text-right font-medium">RD</th>
              </tr>
            </thead>
            <tbody>
              {#each data.best_race.slice(0, 15) as p}
                <tr class="border-t border-border/40 hover:bg-muted/20">
                  <td class="px-3 py-2 font-mono text-muted-foreground">{p.rank}</td>
                  <td class="px-2 py-2 font-semibold truncate max-w-40">{p.display_name}</td>
                  <td class="px-2 py-2">
                    <span class="inline-flex items-center gap-1">
                      <RaceIcon race={p.race} size={12} />
                      <span class="text-muted-foreground">{RACE_NAMES[p.race] || p.race}</span>
                    </span>
                  </td>
                  <td class="px-2 py-2 text-right font-mono font-bold text-primary">{num(p.mmr)}</td>
                  <td class="px-2 py-2 text-right font-mono text-muted-foreground">{p.games}</td>
                  <td class="px-3 py-2 text-right font-mono text-muted-foreground">{num(p.rd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="rounded-xl border border-border bg-card overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <h2 class="text-sm font-bold">种族榜</h2>
          <p class="text-[11px] text-muted-foreground mt-0.5">actual race 分榜；Random 按实际种族计入，不单独设榜</p>
        </div>
        <div class="flex gap-1">
          {#each RACES as race}
            <button
              type="button"
              onclick={() => (raceTab = race)}
              class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold transition-colors
                {raceTab === race
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/50'}"
            >
              <RaceIcon race={race} size={13} />
              {race}
            </button>
          {/each}
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="text-[11px] text-muted-foreground bg-muted/30">
            <tr>
              <th class="px-3 py-2 text-left font-medium">#</th>
              <th class="px-2 py-2 text-left font-medium">选手</th>
              <th class="px-2 py-2 text-right font-medium">MMR</th>
              <th class="px-2 py-2 text-right font-medium">RD</th>
              <th class="px-2 py-2 text-right font-medium">场次</th>
              <th class="px-2 py-2 text-right font-medium">W-L</th>
              <th class="px-3 py-2 text-left font-medium">样本</th>
            </tr>
          </thead>
          <tbody>
            {#each data.races[raceTab].slice(0, 20) as p}
              <tr class="border-t border-border/40 hover:bg-muted/20">
                <td class="px-3 py-2 font-mono text-muted-foreground">{p.rank}</td>
                <td class="px-2 py-2 font-semibold truncate max-w-48">{p.display_name}</td>
                <td class="px-2 py-2 text-right font-mono font-bold text-primary">{num(p.mmr)}</td>
                <td class="px-2 py-2 text-right font-mono text-muted-foreground">{num(p.rd)}</td>
                <td class="px-2 py-2 text-right font-mono text-muted-foreground">{p.games}</td>
                <td class="px-2 py-2 text-right font-mono text-muted-foreground">{p.wins}-{p.losses}</td>
                <td class="px-3 py-2">
                  {#if p.games < data.meta.min_race_games}
                    <span class="text-[11px] text-amber-500">低样本</span>
                  {:else}
                    <span class="text-[11px] text-emerald-500">可用</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <details class="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
      <summary class="cursor-pointer font-semibold text-foreground">实验说明与参数</summary>
      <div class="mt-3 space-y-2 leading-relaxed">
        <p>
          <strong>总榜：</strong>所有对局一起拟合 Bradley-Terry，H2H 直接进入似然。副族（pick != 主族，且不是 Random）对低 150 分以上的对手时，整场权重降到 0.25；
          Random 主族选手不套用副族惩罚。
        </p>
        <p>
          <strong>种族榜：</strong>按 actual play race 分开维护 Glicko-2；初始 RD 250，7 天一个不活跃周期。P/T/Z 三个桶互不影响。
        </p>
        <p>
          <strong>最高族：</strong>每个选手取 P/T/Z 中最高分，但至少 {data.meta.min_race_games} 场；低于此场次会显示“低样本”。
        </p>
        <p>
          主族覆盖：
          {#each Object.entries(data.meta.main_race_overrides) as [id, race], i}
            {id} = {race}{#if i < Object.entries(data.meta.main_race_overrides).length - 1}，{/if}
          {/each}
          其他选手目前按 pick race 多数推断，可能需要继续修正。
        </p>
      </div>
    </details>
  {/if}
</div>

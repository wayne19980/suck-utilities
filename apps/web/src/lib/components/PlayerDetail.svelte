<script>
  import { API } from "$lib/api.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import RaceIcon from "$lib/components/RaceIcon.svelte";
  import TierBadge from "$lib/components/TierBadge.svelte";
  import MmrChart from "$lib/components/ladder/mmr-chart.svelte";
  import { daysAgo, readMmrChartMode, writeMmrChartMode } from "$lib/ladder.js";
  import TrendingUpIcon from "@lucide/svelte/icons/trending-up";
  import UsersIcon from "@lucide/svelte/icons/users";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import AwardIcon from "@lucide/svelte/icons/award";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ArrowBigUpIcon from "@lucide/svelte/icons/arrow-big-up";
  import ArrowBigDownIcon from "@lucide/svelte/icons/arrow-big-down";

  let { player } = $props();

  let mmrDetail = $state(null);
  let mmrLoading = $state(false);
  let requestId = 0;
  let chartMode = $state(readMmrChartMode());

  $effect(() => {
    const id = player?.id;
    const request = ++requestId;
    mmrDetail = null;
    if (!id || !(player?.ladder_games > 0)) {
      mmrLoading = false;
      return;
    }
    mmrLoading = true;
    API.getLadderPlayer(id)
      .then((detail) => {
        if (request === requestId) mmrDetail = detail;
      })
      .catch(() => {
        if (request === requestId) mmrDetail = null;
      })
      .finally(() => {
        if (request === requestId) mmrLoading = false;
      });
  });

  const getRaceName = (r) => {
    const map = { P: "Protoss", T: "Terran", Z: "Zerg", R: "Random", U: "Unknown" };
    return map[r] ?? "Unknown";
  };

  const getRaceColorClass = (r) => {
    const map = {
      P: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
      T: "bg-blue-500/10 text-blue-400 border-blue-500/25",
      Z: "bg-rose-500/10 text-rose-400 border-rose-500/25",
      R: "bg-purple-500/10 text-purple-400 border-purple-500/25",
      U: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25",
    };
    return map[r] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/25";
  };

  function formatSeconds(sec) {
    if (!sec || Number.isNaN(sec)) return "0秒";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}分${s}秒`;
  }

  const flagEmoji = (f) => {
    const map = { cn: "🇨🇳", hk: "🇭🇰", tw: "🇹🇼", us: "🇺🇸", kr: "🇰🇷", de: "🇩🇪", fr: "🇫🇷" };
    return map[(f || "").toLowerCase()] ?? "🏳️";
  };

  const avatarColors = [
    "from-amber-500 to-orange-500",
    "from-purple-500 to-indigo-500",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-500",
    "from-rose-500 to-pink-500",
    "from-violet-500 to-fuchsia-500",
  ];

  function getGradient(id) {
    let sum = 0;
    for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
    return avatarColors[sum % avatarColors.length];
  }

  function formatLabel(format) {
    return format === "winner_advances" ? "胜者晋级" : "败者晋级";
  }

  function tournamentTitle(t) {
    const parts = [t.name];
    if (t.place === "champion") parts.push("冠军");
    else if (t.place === "runner_up") parts.push("亚军");
    if (t.place) parts.push(formatLabel(t.format));
    if (t.created_at) parts.push(new Date(t.created_at).toLocaleDateString("zh-CN"));
    return parts.join(" · ");
  }
</script>

      <div class="relative space-y-4 overflow-hidden">
        <div class="absolute right-0 top-0 w-24 h-24 bg-linear-to-br from-primary/10 to-indigo-500/10 rounded-full blur-xl pointer-events-none"></div>
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-linear-to-br {getGradient(player.id)} flex items-center justify-center text-base font-black text-white uppercase shadow-inner shadow-black/10">
              {player.display_name.slice(0, 2)}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-extrabold text-foreground">{player.display_name}</h3>
                <span class="text-sm shrink-0">{flagEmoji(player.flag)}</span>
                <Badge variant="outline" class="gap-1 text-[11px] px-1.5 py-0 uppercase tracking-wider {getRaceColorClass(player.main_race)}">
                  <RaceIcon race={player.main_race} size={14} />
                  {getRaceName(player.main_race)}
                </Badge>
                <TierBadge tier={player.tier} />
              </div>
              <p class="text-[11px] text-muted-foreground mt-0.5 font-mono">
                ID: {player.id} {#if player.team}· 战队: [{player.team}]{/if}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-6">
            <div class="text-center sm:text-right">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">赛事胜率</span>
              <span class="text-xl font-black text-primary font-mono">{Math.round(player.match_win_rate * 100)}%</span>
            </div>
            <div class="text-center sm:text-right border-l border-border/60 pl-6">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">单局胜率</span>
              <span class="text-xl font-black text-foreground font-mono">{Math.round(player.map_win_rate * 100)}%</span>
            </div>
            <div class="text-center sm:text-right border-l border-border/60 pl-6">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">MMR</span>
              <span class="text-xl font-black text-foreground font-mono">{player.mmr ?? "--"}</span>
              {#if player.ladder_rank}
                <span class="block text-[11px] text-muted-foreground font-mono">#{player.ladder_rank}</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- Grid stats details -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Column 1: Matchups (Z, T, P) -->
          <div class="space-y-3 bg-muted/5 border border-border/40 p-3.5 rounded-xl">
            <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1">
              <TrendingUpIcon class="w-3.5 h-3.5 text-primary" />
              种族对抗战绩 (单局)
            </h4>
            <div class="space-y-2">
              <div class="grid grid-cols-4 gap-1 text-[11px]">
                <div></div>
                {#each ['T', 'P', 'Z'] as opp}
                  <div class="text-center font-mono text-muted-foreground font-bold">{opp}</div>
                {/each}
                {#each ['T', 'P', 'Z'] as my}
                  <div class="flex items-center font-bold text-muted-foreground">{my}v</div>
                  {#each ['T', 'P', 'Z'] as opp}
                    {@const rec = player.matchups?.[my]?.[opp]}
                    {@const total = rec?.total ?? 0}
                    {@const won = rec?.won ?? 0}
                    {@const rate = total > 0 ? won / total : 0}
                    <div
                      class="rounded border px-0.5 py-1 text-center font-mono text-[11px] leading-none {total === 0
                        ? 'border-border/30 text-muted-foreground/35'
                        : rate >= 0.5
                          ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400'
                          : 'border-rose-500/25 bg-rose-500/8 text-rose-600 dark:text-rose-400'}"
                      title={`${my}v${opp}: ${won}-${total - won}${total > 0 ? ` (${Math.round(rate * 100)}%)` : ''}`}
                    >
                      {#if total > 0}{won}-{total - won}{:else}—{/if}
                    </div>
                  {/each}
                {/each}
              </div>
              <p class="text-[11px] text-muted-foreground/70 leading-tight">行 = 自己种族，列 = 对手；未打过显示 —</p>
            </div>
          </div>

          <!-- Column 2: Social/Rivals -->
          <div class="space-y-3 bg-muted/5 border border-border/40 p-3.5 rounded-xl">
            <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1">
              <UsersIcon class="w-3.5 h-3.5 text-primary" />
              宿命对抗关系
            </h4>
            <div class="space-y-3.5 pt-1">
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-rose-400 font-bold flex items-center gap-1">
                    <ShieldAlertIcon class="w-3.5 h-3.5" />
                    一生之敌 (Nemesis)
                  </span>
                </div>
                {#if player.nemesis}
                  <div class="mt-1.5 p-2 rounded bg-red-500/5 border border-red-500/10 flex justify-between items-center text-xs">
                    <span class="font-bold text-foreground">{player.nemesis.display_name}</span>
                    <span class="font-mono text-rose-400">输过 <span class="font-bold">{player.nemesis.count}</span> 次大场</span>
                  </div>
                {:else}
                  <div class="mt-1.5 text-muted-foreground/50 text-[11px] italic">暂无宿敌</div>
                {/if}
              </div>
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-emerald-400 font-bold flex items-center gap-1">
                    <AwardIcon class="w-3.5 h-3.5" />
                    提款机 (Favorite)
                  </span>
                </div>
                {#if player.favorite}
                  <div class="mt-1.5 p-2 rounded bg-emerald-500/5 border border-emerald-500/10 flex justify-between items-center text-xs">
                    <span class="font-bold text-foreground">{player.favorite.display_name}</span>
                    <span class="font-mono text-emerald-400">赢过 <span class="font-bold">{player.favorite.count}</span> 次大场</span>
                  </div>
                {:else}
                  <div class="mt-1.5 text-muted-foreground/50 text-[11px] italic">暂无提款机</div>
                {/if}
              </div>
            </div>
          </div>

          <!-- Column 3: Fun Facts / Playtime -->
          <div class="space-y-3 bg-muted/5 border border-border/40 p-3.5 rounded-xl">
            <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1">
              <ClockIcon class="w-3.5 h-3.5 text-primary" />
              选手趣味花边
            </h4>
            <div class="space-y-2.5 pt-1">
              <div class="flex items-center justify-between border-b border-border/40 pb-2">
                <span class="text-[11px] text-muted-foreground">局均比赛时长</span>
                <span class="text-xs font-mono font-bold text-foreground">
                  {player.avg_game_length ? formatSeconds(player.avg_game_length) : '暂无'}
                </span>
              </div>
              <div class="flex items-center justify-between border-b border-border/40 pb-2">
                <span class="text-[11px] text-muted-foreground">不战而胜 (对手弃权)</span>
                <span class="text-xs font-mono font-bold text-emerald-400">{player.walkover_wins} 次</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-muted-foreground">放人鸽子 (自身弃权)</span>
                <span class="text-xs font-mono font-bold text-rose-500">{player.walkover_losses} 次</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Podium honours, split by bracket format -->
        <div class="border-t border-border/50 pt-4 space-y-2">
          <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <TrophyIcon class="w-3.5 h-3.5 text-amber-500" />
            冠亚军战绩
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {#each [{ key: "loser_advances", label: "败者晋级赛事" }, { key: "winner_advances", label: "胜者晋级赛事" }] as format}
              <div class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                <span class="text-[11px] font-bold text-muted-foreground">{format.label}</span>
                <span class="flex items-center gap-3 text-[11px] font-mono shrink-0">
                  <span class="inline-flex items-center gap-1">
                    <TrophyIcon class="w-3.5 h-3.5 text-amber-500" />
                    冠军 <b class="text-amber-500">{player.champion?.[format.key] ?? 0}</b>
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <AwardIcon class="w-3.5 h-3.5 text-slate-400" />
                    亚军 <b class="text-foreground/80">{player.runner_up?.[format.key] ?? 0}</b>
                  </span>
                </span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Participated Tournaments -->
        {#if player.tournaments?.length > 0}
          <div class="border-t border-border/50 pt-4 space-y-2">
            <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrophyIcon class="w-3.5 h-3.5 text-amber-500" />
              参加过的赛事
            </h4>
            <div class="flex flex-wrap gap-1.5">
              {#each player.tournaments as t}
                <a
                  href="/tournament/{encodeURIComponent(t.id)}"
                  class="text-[11px] px-2 py-1 rounded-md bg-muted/30 border border-border/60 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors font-mono truncate max-w-48"
                  title={tournamentTitle(t)}
                >
                  {#if t.place}
                    <span class="mr-1 font-bold {t.place === "champion" ? "text-amber-500" : "text-slate-400"}">{t.place === "champion" ? "冠" : "亚"}</span>
                  {/if}
                  {t.name}
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Ladder MMR trend -->
        <div class="border-t border-border/50 pt-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUpIcon class="w-3.5 h-3.5 text-sky-400" />
              MMR 走势
            </h4>
            {#if mmrDetail?.history?.length}
              <Tabs.Root
                bind:value={chartMode}
                onValueChange={(value) => value && writeMmrChartMode(value)}
              >
                <Tabs.List
                  class="h-7 group-data-horizontal/tabs:h-7 gap-0.5 rounded-lg border border-border/70 bg-background/40 p-0.5"
                >
                  <Tabs.Trigger value="time" class="h-full px-2 text-[11px] font-semibold">
                    按时间
                  </Tabs.Trigger>
                  <Tabs.Trigger value="game" class="h-full px-2 text-[11px] font-semibold">
                    按场次
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>
            {/if}
          </div>
          {#if mmrLoading}
            <div class="py-6 text-center text-xs text-muted-foreground">加载天梯记录...</div>
          {:else if mmrDetail?.history?.length}
            <div class="rounded-xl border border-border/60 bg-background/30 px-2 pt-2 pb-1">
              <MmrChart history={mmrDetail.history} mode={chartMode} />
            </div>
            <div class="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
              <span>最近对局</span>
              <span>{mmrDetail.history.length} 场</span>
            </div>
            <div class="space-y-1.5 max-h-64 overflow-y-auto">
              {#each mmrDetail.history as h (h.game_id + "-" + h.player_id)}
                {@const oppDelta = (h.opponent_mmr_after ?? h.opponent_mmr) - h.opponent_mmr}
                <div class="overflow-hidden rounded-lg border border-border/60 bg-background/40">
                  <div class="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
                    <div class="flex items-center gap-3 p-3 {h.mmr_delta >= 0 ? 'bg-emerald-500/[0.05]' : 'bg-rose-500/[0.05]'}">
                      {#if h.mmr_delta >= 0}
                        <ArrowBigUpIcon class="w-7 h-7 shrink-0 fill-emerald-400/15 text-emerald-400" />
                      {:else}
                        <ArrowBigDownIcon class="w-7 h-7 shrink-0 fill-rose-400/15 text-rose-400" />
                      {/if}
                      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px]">
                        <span class="text-muted-foreground">匹配等级(MMR):</span>
                        <span class="font-mono text-base font-black text-foreground">{h.mmr_after}</span>
                        <span class="font-mono font-bold {h.mmr_delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                          {h.mmr_delta >= 0 ? "+" : ""}{h.mmr_delta}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 p-3 {oppDelta >= 0 ? 'bg-emerald-500/[0.05]' : 'bg-rose-500/[0.05]'}">
                      {#if oppDelta >= 0}
                        <ArrowBigUpIcon class="w-7 h-7 shrink-0 fill-emerald-400/15 text-emerald-400" />
                      {:else}
                        <ArrowBigDownIcon class="w-7 h-7 shrink-0 fill-rose-400/15 text-rose-400" />
                      {/if}
                      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px]">
                        <span class="text-muted-foreground">匹配等级(MMR):</span>
                        <span class="font-mono text-base font-black text-foreground">{h.opponent_mmr_after ?? h.opponent_mmr}</span>
                        <span class="font-mono font-bold {oppDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                          {oppDelta >= 0 ? "+" : ""}{oppDelta}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if h.race}<RaceIcon race={h.race} size={12} />{/if}
                      <span class="truncate font-semibold text-foreground">{player.display_name}</span>
                      <span class="shrink-0 text-muted-foreground/70">vs</span>
                      {#if h.opponent_race}<RaceIcon race={h.opponent_race} size={12} />{/if}
                      <span class="truncate font-semibold text-foreground">{h.opponent_name}</span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2">
                      <span class="truncate">{h.tournament_name} · {daysAgo(h.played_at)}</span>
                      <span class="font-mono text-foreground">{h.score_for}-{h.score_against}</span>
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-[11px] text-muted-foreground/60 italic">暂无可计算 MMR 的对局。</p>
          {/if}
        </div>
      </div>

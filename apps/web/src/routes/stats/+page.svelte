<script>
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { API } from "$lib/api.js";
  import { userState } from "$lib/user.svelte.js";
  import RaceIcon from "$lib/components/RaceIcon.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import SearchIcon from "@lucide/svelte/icons/search";
  import UsersIcon from "@lucide/svelte/icons/users";
  import TrendingUpIcon from "@lucide/svelte/icons/trending-up";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import AwardIcon from "@lucide/svelte/icons/award";
  import MapIcon from "@lucide/svelte/icons/map";
  import CrownIcon from "@lucide/svelte/icons/crown";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import TierBadge from "$lib/components/TierBadge.svelte";
  import { daysAgo } from "$lib/ladder.js";
  import PlayerDetail from "$lib/components/PlayerDetail.svelte";
  // Stats Data States
  let statsData = $state(null);
  let playTimes = $state(null);
  let statsLoading = $state(true);
  let playTimeMax = $derived(
    playTimes ? Math.max(1, ...playTimes.weekdays) : 1,
  );
  let selectedStatPlayer = $state(null);
  let statsSearchQuery = $state("");
  const MIN_MATCHES_OPTIONS = [
    { value: "0", label: "全部场次" },
    { value: "2", label: "≥ 2 场" },
    { value: "5", label: "≥ 5 场" },
    { value: "10", label: "≥ 10 场" },
  ];
  let minMatchesFilter = $state("0");
  let minMatchesLabel = $derived(
    MIN_MATCHES_OPTIONS.find((option) => option.value === minMatchesFilter)?.label ||
      "全部场次",
  );
  let onlyActive = $state(true);
  let ladderPlayers = $state([]);
  // Sorting Control
  let statsSortField = $state("mmr");
  let statsSortOrder = $state("desc");
  // Ladder summary (mirrors the former /ladder page)
  let ladderViewPlayers = $derived(
    onlyActive ? ladderPlayers.filter((p) => p.active) : ladderPlayers,
  );
  let ladderTop = $derived(ladderViewPlayers[0] || null);
  let myLadderRank = $derived.by(() => {
    if (!userState.id) return null;
    const index = ladderViewPlayers.findIndex((p) => p.id === userState.id);
    return index >= 0 ? index + 1 : null;
  });
  let myLadder = $derived(
    userState.id ? ladderPlayers.find((p) => p.id === userState.id) : null,
  );
  function handleStatsSort(field) {
    if (statsSortField === field) {
      statsSortOrder = statsSortOrder === "asc" ? "desc" : "asc";
    } else {
      statsSortField = field;
      statsSortOrder = "desc";
    }
  }
  // Derived sorted and filtered statistics list
  let sortedStatsPlayers = $derived.by(() => {
    if (!statsData?.players) return [];
    const query = statsSearchQuery.toLowerCase().trim();
    const filtered = statsData.players.filter(p => {
      const matchesSearch = p.id.toLowerCase().includes(query) ||
             p.display_name.toLowerCase().includes(query) ||
             p.team.toLowerCase().includes(query);
      const minMatches = Number(minMatchesFilter) || 0;
      const meetsMinMatches = minMatches === 0 || p.matches_played >= minMatches;
      const meetsActive = !onlyActive || p.ladder_active;
      return matchesSearch && meetsMinMatches && meetsActive;
    });
    return filtered.sort((a, b) => {
      let valA = a[statsSortField];
      let valB = b[statsSortField];
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;
      if (typeof valA === "string") {
        return statsSortOrder === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return statsSortOrder === "asc" ? valA - valB : valB - valA;
    });
  });
  function podiumRows(format) {
    return (statsData?.players || [])
      .map((p) => ({
        ...p,
        format_champion: p.champion?.[format] ?? 0,
        format_runner_up: p.runner_up?.[format] ?? 0,
      }))
      .filter((p) => p.format_champion > 0 || p.format_runner_up > 0)
      .sort(
        (a, b) =>
          b.format_champion - a.format_champion ||
          b.format_runner_up - a.format_runner_up,
      )
      .slice(0, 5);
  }
  let podiumBoards = $derived({
    loser: podiumRows("loser_advances"),
    winner: podiumRows("winner_advances"),
  });
  async function loadStats() {
    statsLoading = true;
    try {
      const [stats, times, ladder] = await Promise.all([
        API.getPlayerStatistics(),
        API.getPlayTimes().catch(() => null),
        API.getLadder({ includeInactive: true }).catch(() => ({ players: [] })),
      ]);
      const ladderById = new Map(
        (ladder?.players || []).map((p) => [p.id, p]),
      );
      statsData = {
        ...stats,
        players: (stats?.players || []).map((p) => {
          const l = ladderById.get(p.id);
          return {
            ...p,
            mmr: l?.mmr ?? null,
            tier: l?.tier ?? null,
            ladder_rank: l?.rank ?? null,
            ladder_games: l?.games ?? 0,
            ladder_active: l?.active ?? false,
            provisional: l?.provisional ?? true,
          };
        }),
      };
      ladderPlayers = ladder?.players || [];
      playTimes = times;
    } catch (e) {
      toast.error("加载统计数据失败: " + e.message);
    }
    statsLoading = false;
  }
  function selectStatPlayer(player) {
    selectedStatPlayer = selectedStatPlayer?.id === player?.id ? null : player;
  }

  onMount(loadStats);
  // ── Helpers ───────────────────────────────────────────────────────
  const getRaceName = (r) => {
    const map = {
      P: "Protoss",
      T: "Terran",
      Z: "Zerg",
      R: "Random",
      U: "Unknown"
    };
    return map[r] ?? "Unknown";
  };
  const getRaceColorClass = (r) => {
    const map = {
      P: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
      T: "bg-blue-500/10 text-blue-400 border-blue-500/25",
      Z: "bg-rose-500/10 text-rose-400 border-rose-500/25",
      R: "bg-purple-500/10 text-purple-400 border-purple-500/25",
      U: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"
    };
    return map[r] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/25";
  };
  function formatSeconds(sec) {
    if (!sec || isNaN(sec)) return "0秒";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}分${s}秒`;
  }
  const flagEmoji = (f) => {
    const map = {
      cn: "🇨🇳",
      hk: "🇭🇰",
      tw: "🇹🇼",
      us: "🇺🇸",
      kr: "🇰🇷",
      de: "🇩🇪",
      fr: "🇫🇷",
    };
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
    let s = 0;
    for (let i = 0; i < id.length; i++) s += id.charCodeAt(i);
    return avatarColors[s % avatarColors.length];
  }
</script>
<div class="space-y-6">
  <!-- Page header -->
  <div class="flex items-center justify-between border-b border-border/60 pb-5">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-primary bg-clip-text text-transparent">
        数据统计
      </h1>
      <p class="text-xs text-muted-foreground mt-1">
        分析赛事选手表现，挖掘趣味数据与胜率统计
      </p>
    </div>
  </div>
  {#if statsLoading}
    <div class="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground bg-card/20 border border-border border-dashed rounded-xl">
      <div class="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
      <p class="text-sm font-semibold">正在整理选手生涯战绩与趣味榜单...</p>
    </div>
  {:else}
    {#if statsData}
      <!-- Global stats cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-primary/20 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <UsersIcon class="w-4 h-4" />
          </div>
          <div>
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">参赛选手</span>
            <span class="text-lg font-black text-foreground">{statsData.global.total_players} <span class="text-xs font-normal text-muted-foreground">人</span></span>
          </div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-primary/20 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <TrophyIcon class="w-4 h-4" />
          </div>
          <div>
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">举办赛事</span>
            <span class="text-lg font-black text-foreground">{statsData.global.total_tournaments} <span class="text-xs font-normal text-muted-foreground">届</span></span>
          </div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-primary/20 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
            <ActivityIcon class="w-4 h-4" />
          </div>
          <div>
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">完成对局</span>
            <span class="text-lg font-black text-foreground">{statsData.global.total_matches} <span class="text-xs font-normal text-muted-foreground">场</span></span>
          </div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-primary/20 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
            <ZapIcon class="w-4 h-4" />
          </div>
          <div>
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">录像备份</span>
            <span class="text-lg font-black text-foreground">{statsData.global.total_replays} <span class="text-xs font-normal text-muted-foreground">局</span></span>
          </div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-primary/20 transition-colors col-span-2 md:col-span-1">
          <div class="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
            <ClockIcon class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold truncate">局均耗时</span>
            <span class="text-sm font-black text-foreground block truncate mt-0.5">{formatSeconds(statsData.global.avg_game_length)}</span>
          </div>
        </div>
      </div>
      <!-- Ladder summary cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-amber-500/30 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <CrownIcon class="w-4 h-4" />
          </div>
          <div class="min-w-0 flex-1">
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">MMR 第一</span>
            {#if ladderTop}
              <div class="flex items-center gap-2 min-w-0 mt-0.5">
                <span class="text-base font-black text-foreground truncate">{ladderTop.display_name}</span>
                <span class="text-sm font-mono font-black text-primary shrink-0">{ladderTop.mmr}</span>
                <TierBadge tier={ladderTop.tier} className="shrink-0" />
              </div>
            {:else}
              <span class="text-sm text-muted-foreground">暂无数据</span>
            {/if}
          </div>
        </div>
        <div class="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:border-sky-500/30 transition-colors">
          <div class="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-400 shrink-0">
            <UserRoundIcon class="w-4 h-4" />
          </div>
          <div class="min-w-0 flex-1">
            <span class="text-[11px] text-muted-foreground uppercase tracking-wider block font-bold">我的排名</span>
            {#if myLadderRank}
              <div class="flex items-center gap-2 min-w-0 mt-0.5">
                <span class="text-base font-black text-foreground font-mono">#{myLadderRank}</span>
                <span class="text-sm font-mono text-foreground">{myLadder?.mmr}</span>
                {#if myLadder?.tier}
                  <TierBadge tier={myLadder.tier} className="shrink-0" />
                {/if}
              </div>
            {:else}
              <span class="text-sm text-muted-foreground">未上榜</span>
            {/if}
          </div>
        </div>
      </div>
      {#if playTimes && playTimes.total_nights > 0}
        <div class="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
                <ClockIcon class="w-4 h-4 text-purple-400" />
                大家一般什么时候打
              </h3>
              <p class="text-[11px] text-muted-foreground mt-0.5">
                基于 {playTimes.total_nights} 个比赛夜 / {playTimes.total_games} 场录像的实际开始时间
              </p>
            </div>
            <div class="text-[11px] text-muted-foreground/60 font-mono">
              最常开打：{playTimes.top_slots[0]
                ? `${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][playTimes.top_slots[0].weekday]} ${playTimes.top_slots[0].time}`
                : "暂无"}
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
            <div class="space-y-1.5">
              {#each ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as label, idx}
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="w-8 text-muted-foreground shrink-0">{label}</span>
                  <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      class="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full"
                      style="width: {Math.round(((playTimes.weekdays[idx] || 0) / playTimeMax) * 100)}%"
                    ></div>
                  </div>
                  <span class="w-7 text-right font-mono text-muted-foreground">{playTimes.weekdays[idx] || 0}</span>
                </div>
              {/each}
            </div>
            <div class="flex flex-wrap content-start gap-1.5">
              {#each playTimes.top_slots.slice(0, 6) as slot}
                <span class="text-[11px] px-2 py-1 rounded-full border border-border/70 bg-muted/30 font-mono text-muted-foreground">
                  {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][slot.weekday]} {slot.time}
                  <span class="text-primary font-bold ml-1">{slot.count}</span>
                </span>
              {/each}
            </div>
          </div>
        </div>
      {/if}
      <!-- Main statistics layout -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left + Mid: Roster Statistics Table and Detailed Profile -->
        <div class="lg:col-span-2 space-y-6">
          <div class="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div class="p-4 border-b border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 bg-muted/5">
              <div>
                <h3 class="text-sm font-bold text-foreground">选手表现总览</h3>
                <p class="text-[11px] text-muted-foreground mt-0.5">点击选手展开/收起详细数据</p>
                <p class="text-[11px] text-muted-foreground/60 mt-0.5">冠军 / 亚军：败 = 败者晋级赛事，胜 = 胜者晋级赛事</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none shrink-0">
                  <Checkbox bind:checked={onlyActive} />
                  只看一年内有对局
                </label>
                <!-- Min matches filter -->
                <Select.Root
                  type="single"
                  bind:value={minMatchesFilter}
                  items={MIN_MATCHES_OPTIONS}
                >
                  <Select.Trigger size="sm" class="h-7 w-24 text-xs bg-muted/40">
                    {minMatchesLabel}
                  </Select.Trigger>
                  <Select.Content>
                    {#each MIN_MATCHES_OPTIONS as option}
                      <Select.Item value={option.value} label={option.label}>
                        {option.label}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <!-- Search -->
                <div class="relative w-full sm:w-52">
                  <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 z-10" />
                  <Input
                    bind:value={statsSearchQuery}
                    placeholder="搜索选手..."
                    class="pl-8 h-7 text-xs"
                  />
                </div>
              </div>
            </div>
            <!-- Table (desktop) -->
            <div class="hidden sm:block overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-muted/10 border-b border-border text-muted-foreground text-[11px] uppercase font-bold tracking-wider select-none">
                    <th class="py-2.5 px-3 cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors w-36" onclick={() => handleStatsSort("display_name")}>
                      <div class="flex items-center gap-1">
                        <span>选手</span>
                        {#if statsSortField === "display_name"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("main_race")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>种族</span>
                        {#if statsSortField === "main_race"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center">
                      <span>段位</span>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("mmr")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>MMR</span>
                        {#if statsSortField === "mmr"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("match_win_rate")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>胜率 (赛事/单局)</span>
                        {#if statsSortField === "match_win_rate"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("matches_won")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>大场 (W-L)</span>
                        {#if statsSortField === "matches_won"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("maps_won")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>单局 (W-L)</span>
                        {#if statsSortField === "maps_won"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="hidden 2xl:table-cell py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("maps_played")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>局数</span>
                        {#if statsSortField === "maps_played"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("last_game_at")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>最近对局</span>
                        {#if statsSortField === "last_game_at"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("champion_total")}>
                      <div class="flex flex-col items-center leading-tight">
                        <div class="flex items-center justify-center gap-1">
                          <span>冠军</span>
                          {#if statsSortField === "champion_total"}
                            <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                          {/if}
                        </div>
                        <span class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground/60">败 / 胜</span>
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("runner_up_total")}>
                      <div class="flex flex-col items-center leading-tight">
                        <div class="flex items-center justify-center gap-1">
                          <span>亚军</span>
                          {#if statsSortField === "runner_up_total"}
                            <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                          {/if}
                        </div>
                        <span class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground/60">败 / 胜</span>
                      </div>
                    </th>
                    <th class="py-2.5 px-1.5 text-center cursor-pointer hover:bg-muted/20 hover:text-foreground transition-colors" onclick={() => handleStatsSort("tournaments_played")}>
                      <div class="flex items-center justify-center gap-1">
                        <span>参赛数</span>
                        {#if statsSortField === "tournaments_played"}
                          <span class="text-primary">{statsSortOrder === "asc" ? "▲" : "▼"}</span>
                        {/if}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border/60">
                  {#each sortedStatsPlayers as p}
                    <tr
                      onclick={() => selectStatPlayer(p)}
                      class="hover:bg-muted/20 transition-colors cursor-pointer {selectedStatPlayer?.id === p.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}"
                    >
                      <td class="py-2 px-3 font-semibold max-w-36">
                        <div class="flex items-center gap-1 min-w-0">
                           <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                           {#if p.team}
                             <span class="text-[11px] text-muted-foreground font-bold font-mono shrink-0">[{p.team}]</span>
                           {/if}
                           <span class="truncate">{p.display_name}</span>
                        </div>
                      </td>
                      <td class="py-2 px-1.5 text-center">
                        <Badge variant="outline" class="gap-1 text-[11px] px-1 py-0 uppercase tracking-wider {getRaceColorClass(p.main_race)}">
                          <RaceIcon race={p.main_race} />
                          {p.main_race}
                        </Badge>
                      </td>
                      <td class="py-2 px-1.5 text-center">
                        <TierBadge tier={p.tier} />
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono font-black">
                        {#if p.mmr != null}
                          {p.mmr}
                          <span class="block text-[11px] font-normal text-muted-foreground">#{p.ladder_rank}</span>
                        {:else}
                          <span class="text-[11px] italic opacity-50">--</span>
                        {/if}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono font-bold">
                        <div class="flex items-center justify-center gap-1">
                          <span class="{p.match_win_rate >= 0.6 ? 'text-emerald-500' : p.match_win_rate <= 0.4 ? 'text-rose-500/80' : 'text-foreground'}">
                            {Math.round(p.match_win_rate * 100)}%
                          </span>
                          <span class="text-muted-foreground font-normal">/</span>
                          <span class="text-muted-foreground/80 font-normal">
                            {Math.round(p.map_win_rate * 100)}%
                          </span>
                        </div>
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono text-muted-foreground whitespace-nowrap">
                        <span class="font-bold text-foreground">{p.matches_won}</span> - {p.matches_lost}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono text-muted-foreground whitespace-nowrap">
                        <span class="font-bold text-foreground">{p.maps_won}</span> - {p.maps_lost}
                      </td>
                      <td class="hidden 2xl:table-cell py-2 px-1.5 text-center font-mono font-bold text-muted-foreground">
                        {p.maps_played}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {p.last_game_at ? daysAgo(p.last_game_at) : "--"}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono whitespace-nowrap" title="败者晋级赛事 / 胜者晋级赛事">
                        {#if p.champion_total > 0}
                          <span class="font-black text-amber-500">{p.champion.loser_advances}</span>
                          <span class="text-muted-foreground/40">/</span>
                          <span class="font-bold text-amber-500/60">{p.champion.winner_advances}</span>
                        {:else}
                          <span class="text-muted-foreground/40">-</span>
                        {/if}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono whitespace-nowrap" title="败者晋级赛事 / 胜者晋级赛事">
                        {#if p.runner_up_total > 0}
                          <span class="font-black text-foreground/80">{p.runner_up.loser_advances}</span>
                          <span class="text-muted-foreground/40">/</span>
                          <span class="font-bold text-muted-foreground">{p.runner_up.winner_advances}</span>
                        {:else}
                          <span class="text-muted-foreground/40">-</span>
                        {/if}
                      </td>
                      <td class="py-2 px-1.5 text-center font-mono font-bold text-muted-foreground">
                        {p.tournaments_played}
                      </td>
                    </tr>
                    {#if selectedStatPlayer?.id === p.id}
                      <tr class="bg-muted/5">
                        <td colspan="12" class="p-0">
                          <div class="border-t border-border/60 bg-card/40 p-4 sm:p-5">
                            <PlayerDetail player={p} />
                          </div>
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
            <!-- Mobile player list -->
            <div class="sm:hidden divide-y divide-border/60">
              {#each sortedStatsPlayers as p}
                <button
                  type="button"
                  onclick={() => selectStatPlayer(p)}
                  class="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer
                    {selectedStatPlayer?.id === p.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/20'}"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                      {#if p.team}
                        <span class="text-[11px] text-muted-foreground font-bold font-mono shrink-0">[{p.team}]</span>
                      {/if}
                      <span class="truncate font-semibold text-sm">{p.display_name}</span>
                      <Badge variant="outline" class="gap-1 text-[11px] px-1 py-0 uppercase tracking-wider shrink-0 {getRaceColorClass(p.main_race)}">
                        <RaceIcon race={p.main_race} />
                        {p.main_race}
                      </Badge>
                    </div>
                    <div class="text-[11px] text-muted-foreground mt-1 font-mono truncate">
                      MMR {p.mmr ?? "--"} · {p.last_game_at ? daysAgo(p.last_game_at) : "无对局"}
                    </div>
                    <div class="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                      {Math.round(p.match_win_rate * 100)}% / {Math.round(p.map_win_rate * 100)}%
                      · 大场 {p.matches_won}-{p.matches_lost}
                      · 单局 {p.maps_won}-{p.maps_lost}
                      · {p.tournaments_played} 届
                    </div>
                    <div class="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                      冠 <span class="font-bold text-amber-500">{p.champion?.loser_advances ?? 0}/{p.champion?.winner_advances ?? 0}</span>
                      · 亚 <span class="font-bold text-foreground/70">{p.runner_up?.loser_advances ?? 0}/{p.runner_up?.winner_advances ?? 0}</span>
                      · 败/胜
                    </div>
                  </div>
                  <div class="text-right shrink-0">
                    <TierBadge tier={p.tier} />
                    <div class="font-mono font-black text-sm mt-1
                      {p.match_win_rate >= 0.6 ? 'text-emerald-500' : p.match_win_rate <= 0.4 ? 'text-rose-500/80' : 'text-foreground'}">
                      {Math.round(p.match_win_rate * 100)}%
                    </div>
                    <div class="text-[11px] text-muted-foreground">胜率</div>
                  </div>
                </button>
                {#if selectedStatPlayer?.id === p.id}
                  <div class="bg-muted/5 p-4">
                    <PlayerDetail player={p} />
                  </div>
                {/if}
              {/each}
              {#if sortedStatsPlayers.length === 0}
                <div class="py-10 text-center text-xs text-muted-foreground italic">没有匹配的选手。</div>
              {/if}
            </div>
          </div>
        </div>
        <!-- Right: Rankings & Boards -->
        <div class="space-y-6">
          <!-- Board 0: Podiums, split by bracket format -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrophyIcon class="w-4 h-4 text-amber-500" />
              冠亚军榜 (按赛制)
            </h3>
            {#each [{ key: "loser", label: "败者晋级赛事" }, { key: "winner", label: "胜者晋级赛事" }] as board}
              <div class="space-y-2">
                <div class="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                  <span>{board.label}</span>
                  <span class="font-normal">冠军 / 亚军</span>
                </div>
                {#each podiumBoards[board.key] as p, idx}
                  <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="w-5 h-5 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center font-mono font-bold text-[11px] shrink-0">{idx + 1}</span>
                      <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                      <span class="font-bold truncate max-w-24">{p.display_name}</span>
                    </div>
                    <span class="font-mono shrink-0">
                      <span class="font-black text-amber-500">{p.format_champion}</span>
                      <span class="text-muted-foreground/40"> / </span>
                      <span class="font-bold text-muted-foreground">{p.format_runner_up}</span>
                    </span>
                  </div>
                {/each}
                {#if podiumBoards[board.key].length === 0}
                  <div class="text-center py-3 text-[11px] text-muted-foreground italic">暂无{board.label}数据</div>
                {/if}
              </div>
            {/each}
          </div>
          <!-- Board 1: Win Rate Ranking -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrophyIcon class="w-4 h-4 text-amber-500" />
              最强战力榜 (胜率)
            </h3>
            <div class="space-y-3">
              {#each statsData.rankings.by_win_rate as p, idx}
                <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center font-mono font-bold text-[11px]">{idx + 1}</span>
                    <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                    <span class="font-bold truncate max-w-28">{p.display_name}</span>
                  </div>
                  <span class="font-mono font-black text-amber-500">{Math.round(p.match_win_rate * 100)}% <span class="text-[11px] font-normal text-muted-foreground">({p.matches_won}/{p.matches_played})</span></span>
                </div>
              {/each}
              {#if statsData.rankings.by_win_rate.length === 0}
                <div class="text-center py-4 text-[11px] text-muted-foreground italic">暂无战力排行</div>
              {/if}
            </div>
          </div>
          <!-- Board 2: Matches Played Ranking -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ActivityIcon class="w-4 h-4 text-blue-500" />
              劳模战士榜 (局数)
            </h3>
            <div class="space-y-3">
              {#each statsData.rankings.by_played as p, idx}
                <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-mono font-bold text-[11px]">{idx + 1}</span>
                    <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                    <span class="font-bold truncate max-w-28">{p.display_name}</span>
                  </div>
                  <span class="font-mono font-black text-blue-400">{p.matches_played} <span class="text-[11px] font-normal text-muted-foreground">场</span></span>
                </div>
              {/each}
              {#if statsData.rankings.by_played.length === 0}
                <div class="text-center py-4 text-[11px] text-muted-foreground italic">暂无场数排行</div>
              {/if}
            </div>
          </div>
          <!-- Board 3: Walkovers Ranking -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlertIcon class="w-4 h-4 text-purple-500" />
              和平鸽子王 (弃权)
            </h3>
            <div class="space-y-3">
              {#each statsData.rankings.by_walkover as p, idx}
                <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center font-mono font-bold text-[11px]">{idx + 1}</span>
                    <span class="text-sm shrink-0">{flagEmoji(p.flag)}</span>
                    <span class="font-bold truncate max-w-28">{p.display_name}</span>
                  </div>
                  <span class="font-mono font-black text-purple-400">{p.walkover_losses} <span class="text-[11px] font-normal text-muted-foreground">次</span></span>
                </div>
              {/each}
              {#if statsData.rankings.by_walkover.length === 0}
                <div class="text-center py-4 text-[11px] text-muted-foreground italic">暂无弃权排行</div>
              {/if}
            </div>
          </div>
          <!-- Board 4: Game Lengths -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ClockIcon class="w-4 h-4 text-emerald-500" />
              对局时间两极榜
            </h3>
            <div class="space-y-3">
              {#if statsData.rankings.longest_player}
                <div class="space-y-1">
                  <span class="text-[11px] text-muted-foreground block font-bold">⏱️ 最能磨 · 膀胱局大师 (最长局均)</span>
                  <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm shrink-0">{flagEmoji(statsData.rankings.longest_player.flag)}</span>
                      <span class="font-bold">{statsData.rankings.longest_player.display_name}</span>
                    </div>
                    <span class="font-mono font-black text-foreground">{formatSeconds(statsData.rankings.longest_player.avg_game_length)}</span>
                  </div>
                </div>
              {/if}
              {#if statsData.rankings.shortest_player}
                <div class="space-y-1">
                  <span class="text-[11px] text-muted-foreground block font-bold">⚡ 闪电战 · 效率神速者 (最短局均)</span>
                  <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm shrink-0">{flagEmoji(statsData.rankings.shortest_player.flag)}</span>
                      <span class="font-bold">{statsData.rankings.shortest_player.display_name}</span>
                    </div>
                    <span class="font-mono font-black text-foreground">{formatSeconds(statsData.rankings.shortest_player.avg_game_length)}</span>
                  </div>
                </div>
              {/if}
              {#if !statsData.rankings.longest_player && !statsData.rankings.shortest_player}
                <div class="text-center py-4 text-[11px] text-muted-foreground italic">暂无时长排行 (需上传录像)</div>
              {/if}
            </div>
          </div>
          <!-- Board 5: Top Maps -->
          <div class="bg-card border border-border rounded-xl p-4.5 shadow-sm space-y-4">
            <h3 class="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <MapIcon class="w-4 h-4 text-primary" />
              热门地图排行
            </h3>
            <div class="space-y-2">
              {#each statsData.global.top_maps as map, idx}
                <div class="flex items-center justify-between p-2 rounded-lg bg-muted/10 border border-border/40 text-xs">
                  <span class="font-semibold truncate pr-2 font-mono">{idx + 1}. {map.name}</span>
                  <span class="font-mono font-bold text-emerald-400 shrink-0">{map.count} 局</span>
                </div>
              {/each}
              {#if statsData.global.top_maps.length === 0}
                <div class="text-center py-4 border border-dashed border-border rounded-lg text-[11px] text-muted-foreground italic">
                  暂无地图数据 (需上传录像)
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>

<script>
  import { maxRound, roundLabel, buildMatchOrder } from "$lib/bracket.js";
  import RaceIcon from "$lib/components/RaceIcon.svelte";
  import CrownIcon from "@lucide/svelte/icons/crown";

  let { tournament } = $props();

  const matches = $derived(tournament?.matches || []);
  const playersById = $derived(
    new Map((tournament?.players || []).map((p) => [p.id, p])),
  );
  const totalRounds = $derived(maxRound(matches));
  const matchOrder = $derived(buildMatchOrder(matches));

  const rounds = $derived.by(() => {
    const byRound = new Map();
    for (const match of matches) {
      if (!match || match.round === 0) continue;
      if (!byRound.has(match.round)) byRound.set(match.round, []);
      byRound.get(match.round).push(match);
    }
    return [...byRound.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([round, roundMatches]) => ({
        round,
        matches: [...roundMatches].sort(
          (a, b) => a.position - b.position || a.id - b.id,
        ),
      }));
  });

  const firstRoundCount = $derived(rounds[0]?.matches?.length || 0);

  const bracketSpecs = $derived.by(() => {
    if (firstRoundCount >= 8) {
      return {
        H: 64,
        g: 12,
        G: 24,
        cardWidth: "w-40",
        colGap: "gap-6",
        slotOffset: 16,
        connMid: 12,
        connWidth: 12,
        connGap: 24,
      };
    }
    return {
      H: 64,
      g: 20,
      G: 40,
      cardWidth: "w-40",
      colGap: "gap-8",
      slotOffset: 16,
      connMid: 16,
      connWidth: 16,
      connGap: 32,
    };
  });

  const layout = $derived.by(() => {
    const positions = {};
    const centers = {};
    if (rounds.length === 0) {
      return { positions, centers, totalHeight: 300 };
    }

    const { H, g, G } = bracketSpecs;
    const firstRound = rounds[0];
    firstRound.matches.forEach((match, index) => {
      const pairIndex = Math.floor(index / 2);
      const isEven = index % 2 === 0;
      const top = isEven
        ? pairIndex * (2 * H + g + G)
        : pairIndex * (2 * H + g + G) + H + g;
      positions[match.id] = { top, height: H };
      centers[match.id] = top + H / 2;
    });

    for (let roundNumber = firstRound.round - 1; roundNumber >= 1; roundNumber -= 1) {
      const roundData = rounds.find((r) => r.round === roundNumber);
      const childRound = rounds.find((r) => r.round === roundNumber + 1);
      if (!roundData || !childRound) continue;

      roundData.matches.forEach((match, index) => {
        const child1 = childRound.matches[index * 2];
        const child2 = childRound.matches[index * 2 + 1];
        let center = index * 300 + 150;
        if (child1 && child2) {
          center = (centers[child1.id] + centers[child2.id]) / 2;
        } else if (child1) {
          center = centers[child1.id];
        }
        const top = center - H / 2;
        positions[match.id] = { top, height: H };
        centers[match.id] = center;
      });
    }

    const totalHeight =
      firstRound.matches.length > 0
        ? Math.ceil(firstRound.matches.length / 2) * (2 * H + g + G) - G
        : 300;
    return { positions, centers, totalHeight };
  });

  function playerOf(id) {
    return id ? playersById.get(id) : null;
  }

  function playerName(id) {
    if (!id) return "TBD";
    return playerOf(id)?.display_name || id;
  }

  function pickRaceOf(match, side) {
    const id = side === 1 ? match.player1_id : match.player2_id;
    return (
      (side === 1 ? match.p1_pick_race : match.p2_pick_race) ||
      playerOf(id)?.race ||
      (side === 1 ? match.p1_race : match.p2_race) ||
      ""
    );
  }

  function playRaceOf(match, side) {
    const id = side === 1 ? match.player1_id : match.player2_id;
    return (
      (side === 1 ? match.p1_play_race : match.p2_play_race) ||
      playerOf(id)?.play_race ||
      (side === 1 ? match.p1_race : match.p2_race) ||
      pickRaceOf(match, side)
    );
  }

  function isBye(match) {
    return Boolean(
      match &&
        match.status === "completed" &&
        match.winner_id &&
        (!match.player1_id || !match.player2_id),
    );
  }

  function statusLabel(match) {
    if (match.status === "completed") return "完赛";
    if (match.status === "walkover") return "弃权";
    return "待赛";
  }

  function scoreOf(match, side) {
    if (match.status === "pending") return "";
    if (match.status === "walkover") {
      const id = side === 1 ? match.player1_id : match.player2_id;
      return match.winner_id === id ? "W" : "FF";
    }
    return side === 1 ? match.score1 : match.score2;
  }

  function rowBgClass(playerId, race) {
    if (!playerId) {
      return "bg-[#f8f9fa] dark:bg-neutral-900/30 text-neutral-400 dark:text-neutral-500";
    }
    const r = race ? race.toUpperCase() : "U";
    if (r === "T") {
      return "bg-[#d8e8ff] dark:bg-[#152a4a]/40 text-blue-900 dark:text-blue-200 border-l border-blue-500/50";
    }
    if (r === "Z") {
      return "bg-[#ffe2e2] dark:bg-[#3f1515]/40 text-red-900 dark:text-red-200 border-l border-red-500/50";
    }
    if (r === "P") {
      return "bg-[#e2ffe2] dark:bg-[#1a382a]/40 text-emerald-900 dark:text-emerald-200 border-l border-emerald-500/50";
    }
    if (r === "R") {
      return "bg-[#fff7d8] dark:bg-[#3d331a]/30 text-amber-900 dark:text-amber-200 border-l border-amber-500/50";
    }
    return "bg-[#f8f9fa] dark:bg-neutral-900/60 text-neutral-800 dark:text-neutral-200 border-l border-neutral-400 dark:border-l-neutral-500";
  }

  function emptyLabel() {
    if (tournament?.status === "voting") return "时间投票阶段还没有对阵";
    if (tournament?.status === "registration") return "报名阶段还没有生成对阵";
    if (tournament?.status === "in_progress") return "比赛阶段还没有生成对阵";
    return "该赛事暂无对阵数据";
  }
</script>

{#if rounds.length === 0}
  <div class="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center text-[11px] text-muted-foreground">
    {emptyLabel()}
  </div>
{:else}
  <div class={firstRoundCount > 8 ? "max-h-[560px] overflow-auto" : "overflow-x-auto"}>
    <div class="flex justify-start items-stretch min-w-max py-3 pl-5 pr-2 {bracketSpecs.colGap}">
      {#each rounds as round, colIdx (round.round)}
        <div class="shrink-0 flex flex-col justify-start h-full {bracketSpecs.cardWidth}">
          <div class="text-xs text-neutral-200 bg-neutral-800/80 border border-neutral-700/50 py-1.5 px-3 font-bold text-center mb-4 tracking-wider shrink-0 rounded-md shadow-sm">
            {roundLabel(round.round, totalRounds)}
          </div>

          <div class="relative w-full" style="height: {layout.totalHeight}px">
            {#each round.matches as match, idx (match.id)}
              {@const pos = layout.positions[match.id] || { top: 0, height: bracketSpecs.H }}
              {@const p1 = playerOf(match.player1_id)}
              {@const p2 = playerOf(match.player2_id)}
              {@const bye = isBye(match)}
              <div class="absolute left-0 w-full" style="top: {pos.top}px; height: {pos.height}px;">
                {#if bye}
                  <div class="w-full h-full border border-transparent bg-transparent select-none pointer-events-none opacity-0"></div>
                {:else}
                  <span class="absolute -left-2.5 top-1/2 z-10 -translate-y-1/2 rounded border border-neutral-300 bg-white px-1 py-0.5 font-mono text-[11px] font-bold text-neutral-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
                    {matchOrder.get(match.id)}
                  </span>
                  <div class="w-full h-full text-left bg-white dark:bg-[#1c1c1c] border border-neutral-300 dark:border-neutral-800 rounded-md flex flex-col justify-between shadow-md text-xs overflow-hidden">
                    <div class="px-2 py-1 bg-neutral-100 dark:bg-neutral-900 text-[8px] font-mono text-neutral-500 dark:text-neutral-400 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800/80 shrink-0">
                      <span>场次 {match.position}</span>
                      <span>{statusLabel(match)}</span>
                    </div>

                    <div class="flex items-center justify-between w-full h-6 border-b border-neutral-200/50 dark:border-neutral-900/40 {rowBgClass(match.player1_id, pickRaceOf(match, 1))}">
                      <div class="flex items-center gap-1.5 pl-1.5 truncate flex-1 min-w-0 h-full py-0">
                        <span class="w-4 shrink-0 text-right font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{p1?.seed ?? ""}</span>
                        <span class="truncate font-semibold flex items-center gap-0.5 text-[10.5px]
                          {match.winner_id === match.player1_id ? 'text-black dark:text-white font-black' : 'text-neutral-700 dark:text-neutral-300'}
                          {!match.player1_id ? 'text-neutral-400 dark:text-neutral-500/80' : ''}">
                          {#if match.player1_id}
                            <RaceIcon race={pickRaceOf(match, 1)} size={11} />
                            {#if pickRaceOf(match, 1) === "R" && playRaceOf(match, 1) !== "R"}
                              <RaceIcon race={playRaceOf(match, 1)} size={10} />
                            {/if}
                          {/if}
                          {#if match.winner_id === match.player1_id && match.winner_id}
                            <CrownIcon class="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 shrink-0" />
                          {/if}
                          <span class="truncate" title={playerName(match.player1_id)}>{playerName(match.player1_id)}</span>
                        </span>
                      </div>
                      {#if match.status !== "pending"}
                        <div class="w-6 h-full flex items-center justify-center font-mono font-bold text-[11px] bg-neutral-100/60 dark:bg-black/40 text-center shrink-0 border-l border-neutral-200 dark:border-neutral-900/60
                          {match.winner_id === match.player1_id ? 'text-primary font-black' : 'text-neutral-400 dark:text-neutral-500'}">
                          {scoreOf(match, 1)}
                        </div>
                      {/if}
                    </div>

                    <div class="flex items-center justify-between w-full h-6 {rowBgClass(match.player2_id, pickRaceOf(match, 2))}">
                      <div class="flex items-center gap-1.5 pl-1.5 truncate flex-1 min-w-0 h-full py-0">
                        <span class="w-4 shrink-0 text-right font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{p2?.seed ?? ""}</span>
                        <span class="truncate font-semibold flex items-center gap-0.5 text-[10.5px]
                          {match.winner_id === match.player2_id ? 'text-black dark:text-white font-black' : 'text-neutral-700 dark:text-neutral-300'}
                          {!match.player2_id ? 'text-neutral-400 dark:text-neutral-500/80' : ''}">
                          {#if match.player2_id}
                            <RaceIcon race={pickRaceOf(match, 2)} size={11} />
                            {#if pickRaceOf(match, 2) === "R" && playRaceOf(match, 2) !== "R"}
                              <RaceIcon race={playRaceOf(match, 2)} size={10} />
                            {/if}
                          {/if}
                          {#if match.winner_id === match.player2_id && match.winner_id}
                            <CrownIcon class="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 shrink-0" />
                          {/if}
                          <span class="truncate" title={playerName(match.player2_id)}>{playerName(match.player2_id)}</span>
                        </span>
                      </div>
                      {#if match.status !== "pending"}
                        <div class="w-6 h-full flex items-center justify-center font-mono font-bold text-[11px] bg-neutral-100/60 dark:bg-black/40 text-center shrink-0 border-l border-neutral-200 dark:border-neutral-900/60
                          {match.winner_id === match.player2_id ? 'text-primary font-black' : 'text-neutral-400 dark:text-neutral-500'}">
                          {scoreOf(match, 2)}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}

                {#if colIdx < rounds.length - 1}
                  {#if idx % 2 === 0}
                    {@const sibling = round.matches[idx + 1]}
                    {#if sibling}
                      {@const center1 = layout.centers[match.id]}
                      {@const center2 = layout.centers[sibling.id]}
                      {@const vHeight = center2 - center1}
                      {@const isMatchBye = isBye(match)}
                      {@const isSiblingBye = isBye(sibling)}
                      {#if !isMatchBye}
                        <div
                          class="absolute -translate-y-1/2 z-0 line-horizontal-inactive"
                          style="right: -{bracketSpecs.connMid}px; width: {bracketSpecs.connWidth}px; top: {bracketSpecs.H / 2}px;"
                        ></div>
                      {/if}
                      {#if !isSiblingBye}
                        <div
                          class="absolute z-0 line-horizontal-inactive"
                          style="right: -{bracketSpecs.connMid}px; width: {bracketSpecs.connWidth}px; top: {bracketSpecs.H / 2}px; transform: translateY(calc(-50% + {vHeight}px));"
                        ></div>
                      {/if}
                      {#if !isMatchBye}
                        <div
                          class="absolute z-0 line-vertical-inactive"
                          style="right: -{bracketSpecs.connMid}px; top: {bracketSpecs.H / 2}px; height: {vHeight / 2 - bracketSpecs.slotOffset}px;"
                        ></div>
                      {/if}
                      {#if !isSiblingBye}
                        <div
                          class="absolute z-0 line-vertical-inactive"
                          style="right: -{bracketSpecs.connMid}px; top: calc({bracketSpecs.H / 2}px + {vHeight / 2 + bracketSpecs.slotOffset}px); height: {vHeight / 2 - bracketSpecs.slotOffset}px;"
                        ></div>
                      {/if}
                      {#if !isMatchBye}
                        <div
                          class="absolute z-0 line-horizontal-inactive"
                          style="right: -{bracketSpecs.connGap}px; width: {bracketSpecs.connWidth}px; top: calc({bracketSpecs.H / 2}px + {vHeight / 2 - bracketSpecs.slotOffset}px); transform: translateY(-50%);"
                        ></div>
                      {/if}
                      {#if !isSiblingBye}
                        <div
                          class="absolute z-0 line-horizontal-inactive"
                          style="right: -{bracketSpecs.connGap}px; width: {bracketSpecs.connWidth}px; top: calc({bracketSpecs.H / 2}px + {vHeight / 2 + bracketSpecs.slotOffset}px); transform: translateY(-50%);"
                        ></div>
                      {/if}
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .line-horizontal-inactive {
    background: #a2a9b1;
    opacity: 0.8;
    height: 1.5px !important;
  }
  .line-vertical-inactive {
    background: #a2a9b1;
    opacity: 0.8;
    width: 1.5px !important;
  }
  :global(.dark) .line-horizontal-inactive {
    background: #475569;
    opacity: 0.4;
    height: 1.5px !important;
  }
  :global(.dark) .line-vertical-inactive {
    background: #475569;
    opacity: 0.4;
    width: 1.5px !important;
  }
</style>

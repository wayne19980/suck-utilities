<script>
  import { page } from "$app/state";
  import { API } from "$lib/api.js";
  import TournamentOverlay from "$lib/components/TournamentOverlay.svelte";

  // OBS browser source entry point. The URL is owned by the caster, not by a
  // tournament: resolve the caster's current broadcast every 10s and hand the
  // resolved tournament id to the same stage the per-event route uses.
  const POLL_MS = 10000;
  const EXAMPLE_URL = "/overlay?user=<选手ID>";

  let playerId = $derived(page.url.searchParams.get("user") || "");
  let tid = $state("");
  let broadcast = $state(null);
  let lastBroadcast = $state(null);
  let phase = $state("loading"); // loading | live | offline | error
  let errorMsg = $state("");

  async function resolve() {
    if (!playerId) {
      phase = "offline";
      return;
    }
    try {
      const result = await API.getBroadcast(playerId);
      broadcast = result;
      lastBroadcast = result;
      if (result.tournament_id !== tid) tid = result.tournament_id;
      phase = "live";
      errorMsg = "";
    } catch (error) {
      if (error?.status === 404) {
        // The caster ended the stream; blank the stage rather than leaving the
        // previous event's bracket on air.
        tid = "";
        broadcast = null;
        phase = "offline";
        errorMsg = "";
        return;
      }
      // A network blip must never flash an error page into OBS: keep the stage
      // that is already on air and retry on the next tick.
      errorMsg = error?.message || "解析直播失败";
      if (!tid) phase = "error";
    }
  }

  $effect(() => {
    const caster = playerId;
    if (!caster) {
      phase = "offline";
      return;
    }
    tid = "";
    phase = "loading";
    let stopped = false;
    resolve();
    const timer = setInterval(() => {
      if (!stopped) resolve();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });
</script>

<svelte:head>
  <title>{playerId ? `${playerId} · 直播大屏` : "直播大屏"}</title>
</svelte:head>

{#if tid}
  <TournamentOverlay {tid} />
{:else if playerId}
  <div
    class="w-screen h-screen overflow-hidden relative flex items-center justify-center text-white"
    style="background: radial-gradient(circle at 50% 40%, #070d17 0%, #000000 70%);"
  >
    <div class="flex flex-col items-center gap-6 select-none">
      <img src="/favicon.svg" alt="SUCK" class="w-16 h-16 opacity-90" />
      <div class="flex items-center gap-2.5">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
        <span class="text-sm tracking-[0.35em] text-white/60 uppercase">
          {phase === "error" ? "Signal Lost" : "Standby"}
        </span>
      </div>
      <div class="text-center space-y-2">
        <p class="text-3xl font-extrabold tracking-tight">
          {phase === "error" ? "暂时连不上赛事服务" : "暂未开播"}
        </p>
        <p class="text-sm text-white/50">
          {#if phase === "error"}
            {errorMsg}
          {:else}
            主播 <span class="text-white/80 font-mono">{playerId}</span> 还没有开始直播
          {/if}
        </p>
      </div>
      {#if lastBroadcast?.tournament_name}
        <p class="text-xs text-white/35">
          上一场：{lastBroadcast.tournament_name}
        </p>
      {/if}
      <p class="text-[11px] text-white/25 mt-2">
        在赛事页点击「我要直播」后这里会自动出现画面 · 每 10 秒自动同步
      </p>
    </div>
  </div>
{:else}
  <div
    class="w-screen h-screen overflow-hidden relative flex items-center justify-center text-white"
    style="background: radial-gradient(circle at 50% 40%, #070d17 0%, #000000 70%);"
  >
    <div class="flex flex-col items-center gap-5 select-none text-center">
      <img src="/favicon.svg" alt="SUCK" class="w-16 h-16 opacity-90" />
      <p class="text-2xl font-extrabold tracking-tight">缺少 user 参数</p>
      <p class="text-sm text-white/50 leading-relaxed">
        这是绑定到主播的固定直播大屏地址。<br />
        把 <span class="font-mono text-white/80">&lt;选手ID&gt;</span> 换成你的选手 ID 后放进 OBS 浏览器源。
      </p>
      <p class="text-xs font-mono text-white/40 bg-white/5 px-3 py-1.5 rounded">
        {EXAMPLE_URL}
      </p>
    </div>
  </div>
{/if}

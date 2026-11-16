<script>
  import { page } from "$app/state";
  import TournamentOverlay from "$lib/components/TournamentOverlay.svelte";

  let tid = $derived(page.params.id);
</script>

<TournamentOverlay {tid} />

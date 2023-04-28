import { CleanupSnapshots } from "./cleanup-snapshots";

const cleanupSnapshots = new CleanupSnapshots();
cleanupSnapshots.deleteSuperfluousArtifacts().then(r => console.log('finished action removing snapshots'));

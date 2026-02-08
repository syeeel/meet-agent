// Entry point for esbuild to bundle HeyGen SDK for browser use
import StreamingAvatar, {
  StreamingEvents,
  TaskType,
  TaskMode,
  AvatarQuality,
} from '@heygen/streaming-avatar';

// Expose on window for use in main.js
window.HeyGenSDK = {
  StreamingAvatar,
  StreamingEvents,
  TaskType,
  TaskMode,
  AvatarQuality,
};

import { createFileRoute } from "@tanstack/react-router";
import { GameHome } from "@/components/landing/GameHome.js";

export const Route = createFileRoute("/")({
  component: GameHome,
});

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BarChart3, Package, Palette, Factory, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/")({
  component: () => <Navigate to="/dashboard" replace />,
});

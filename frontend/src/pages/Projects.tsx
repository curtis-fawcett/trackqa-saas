import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { FolderKanban } from 'lucide-react';

export function Projects() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Projects</h1>
        <p className="text-slate-400 mt-1">Manage your QA projects.</p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <FolderKanban className="h-12 w-12 text-slate-600 mb-4" />
          <CardTitle className="text-lg text-slate-400 mb-2">No projects yet</CardTitle>
          <p className="text-sm text-slate-600 max-w-sm">
            Projects will appear here once you create them. This feature is coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

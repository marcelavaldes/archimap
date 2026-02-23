import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: 'Query must be at least 2 characters' },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('search_communes', {
      search_term: query,
    });

    if (error) {
      // Log detailed error information
      console.error('Search error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      // Check for common issues
      if (error.code === '42883') {
        // Function does not exist
        return NextResponse.json(
          { error: 'Search function not available. Database migration may be needed.', code: error.code },
          { status: 500 }
        );
      }
      if (error.code === '42704') {
        // Extension not found (pg_trgm)
        return NextResponse.json(
          { error: 'Required extension (pg_trgm) not enabled.', code: error.code },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: `Search failed: ${error.message}`, code: error.code },
        { status: 500 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'public, max-age=300');

    return new NextResponse(JSON.stringify({ results: data }), { headers });
  } catch (error) {
    console.error('API error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

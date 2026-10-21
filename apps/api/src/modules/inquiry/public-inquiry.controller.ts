import { Body, Controller, Headers, Post, Query } from '@nestjs/common';
import { inquiryIntentSchema, type InquiryIntentInput } from '@b2b/validation';
import { ClientIp, Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { InquiryService } from './inquiry.service';

@Controller('public/inquiry-intents')
export class PublicInquiryController {
  constructor(private readonly inquiry: InquiryService) {}

  @Public()
  @Post()
  async create(
    @Body(zodPipe(inquiryIntentSchema)) body: InquiryIntentInput,
    @ClientIp() ip: string | null,
    @Query('sessionId') sessionId?: string,
    @Headers('x-session-id') sessionHeader?: string,
  ) {
    const session = sessionId ?? sessionHeader ?? null;
    return this.inquiry.createIntent(body, {
      ip,
      sessionHash: this.inquiry.hashSession(session),
    });
  }
}

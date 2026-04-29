/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Controller, Post, Body, Req, UseGuards, Get } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('rooms')
@UseGuards(AuthGuard) // <-- This applies the Guard to every route in this file
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  async createRoom(@Body('name') name: string, @Req() req: any) {
    // req.user.id comes from the AuthGuard!
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.roomsService.createRoom(name, req.user.id);
  }
  @Get()
  async getRooms() {
    return this.roomsService.getAllRooms();
  }
}
